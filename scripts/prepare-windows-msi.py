import hashlib
from pathlib import Path, PurePosixPath
import re
import uuid
import xml.etree.ElementTree as ET


def identifier(prefix, destination):
    return prefix + hashlib.sha256(destination.casefold().encode()).hexdigest()[:24]


def prepare_template(root, config, build_output, template_output, base_resources=None):
    root = Path(root)
    overrides = config["bundle"].get("resources", {})
    if not isinstance(overrides, dict) or (base_resources is not None and not isinstance(base_resources, dict)):
        raise ValueError("Per-user MSI resources require explicit source and destination paths")
    # Match Tauri's effective base + override resource map. Otherwise resources
    # added to tauri.conf.json (e.g. the offline engine) disappear from MSI only.
    resources = {**(base_resources or {}), **overrides}
    files = {}
    for source, destination in resources.items():
        destination = PurePosixPath(destination.replace("\\", "/"))
        if destination.is_absolute() or not destination.parts or any(part in ("..", ".") or ":" in part for part in destination.parts):
            raise ValueError("MSI resource destination must stay inside the installation")
        source = (root / "src-tauri" / source).resolve(strict=True)
        entries = [(source, destination)]
        if source.is_dir():
            entries = []
            for child in sorted(source.rglob("*")):
                if child.is_symlink():
                    raise ValueError("MSI resource directories must not contain symlinks")
                if child.is_file():
                    entries.append((child, destination / child.relative_to(source).as_posix()))
            if not entries:
                raise ValueError("MSI resource directory is empty")
        for file, target in entries:
            if not file.is_file():
                raise ValueError("MSI resources must resolve to files")
            key = str(target).casefold()
            if key in files:
                raise ValueError("Duplicate MSI resource destination")
            files[key] = (file, target)
    for source in sorted(Path(build_output).glob("*.dll")):
        key = source.name.casefold()
        if key in files:
            if files[key][0] != source.resolve():
                raise ValueError("Bundled DLL conflicts with a resource")
            continue
        files[key] = (source.resolve(), PurePosixPath(source.name))
    fragment = ET.Element("Fragment")
    directories = {"": fragment}
    references = []
    registry_key = r"Software\{{manufacturer}}\{{product_name}}\InstallerResources"
    for source, destination in sorted(files.values(), key=lambda item: str(item[1]).casefold()):
        parent = fragment
        current = PurePosixPath()
        for part in destination.parts[:-1]:
            current /= part
            key = str(current).casefold()
            if key not in directories:
                directories[key] = ET.SubElement(parent, "Directory", Id=identifier("TuziDir_", key), Name=part)
            parent = directories[key]
        component_id = identifier("TuziResource_", str(destination))
        component = ET.SubElement(parent, "Component", Id=component_id,
                                  Guid=str(uuid.uuid5(uuid.NAMESPACE_URL, "com.tuziswitch.desktop/resource/" + str(destination).casefold())),
                                  Win64="$(var.Win64)")
        ET.SubElement(component, "File", Id=identifier("TuziFile_", str(destination)),
                      Source=str(source), Name=destination.name, KeyPath="no")
        ET.SubElement(component, "RegistryValue", Root="HKCU", Key=registry_key,
                      Name=component_id, Type="integer", Value="1", KeyPath="yes")
        references.append(component_id)
    if len(directories) > 1:
        component_id = "TuziResourceDirectories"
        cleanup = ET.SubElement(fragment, "Component", Id=component_id,
                                Guid=str(uuid.uuid5(uuid.NAMESPACE_URL, "com.tuziswitch.desktop/resource-directories")),
                                Win64="$(var.Win64)")
        for destination in sorted(key for key in directories if key):
            ET.SubElement(cleanup, "RemoveFolder", Id=identifier("TuziRemove_", destination),
                          Directory=identifier("TuziDir_", destination), On="uninstall")
        ET.SubElement(cleanup, "RegistryValue", Root="HKCU", Key=registry_key,
                      Name=component_id, Type="integer", Value="1", KeyPath="yes")
        references.append(component_id)
    template = (root / "src-tauri/wix/per-user-main.wxs").read_text(encoding="utf-8")
    if template.count("{{resources}}") != 1:
        raise ValueError("Unexpected MSI resource template")
    template = template.replace("{{resources}}", "\n".join(ET.tostring(child, encoding="unicode") for child in fragment))
    template, count = re.subn(r"{{#each resource_file_ids as \|resource_file_id\| ~}}.*?{{/each~}}",
                              "\n".join(f'<ComponentRef Id="{component_id}"/>' for component_id in references), template, flags=re.S)
    if count != 1:
        raise ValueError("Unexpected MSI resource references")
    template_output = Path(template_output)
    template_output.parent.mkdir(parents=True, exist_ok=True)
    template_output.write_text(template, encoding="utf-8")
    config["bundle"].setdefault("windows", {}).setdefault("wix", {})["template"] = template_output.relative_to(root / "src-tauri").as_posix()
    return files
