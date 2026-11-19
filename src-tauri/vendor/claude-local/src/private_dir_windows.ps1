$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$stage = 'identity'
try {
    $path = $env:TUZI_CLAUDE_PRIVATE_DIR
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $stage = 'reparse-check'
    if (([IO.File]::GetAttributes($path) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw [IO.IOException]::new('Private directory cannot be a reparse point')
    }
    $stage = 'build-acl'
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    # Owners can change the DACL without WRITE_OWNER. Do not request an owner
    # write when it is already correct (e.g. a directory inheriting Modify).
    $owner = ([IO.Directory]::GetAccessControl($path, [Security.AccessControl.AccessControlSections]::Owner)).GetOwner([Security.Principal.SecurityIdentifier])
    if ($owner.Value -ne $sid.Value) { $acl.SetOwner($sid) }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($principal in @($sid, $system)) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($principal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    $stage = 'write-acl'
    # Set-Acl persists unrelated descriptor sections and, on repeated calls by
    # a standard user, can require SeSecurityPrivilege. Persist ONLY the owner
    # (if changed) and DACL marked modified above; do not request the audit SACL.
    [IO.Directory]::SetAccessControl($path, $acl)
    $stage = 'verify-acl'
    $sections = [Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access
    $actual = [IO.Directory]::GetAccessControl($path, $sections)
    if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {
        throw [IO.IOException]::new('Private directory owner or inheritance verification failed')
    }
    $found = @{}
    foreach ($rule in $actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin @($sid.Value, $system.Value) -or
            $rule.IsInherited -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
            $rule.InheritanceFlags -ne ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit) -or
            $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) {
            throw [IO.IOException]::new('Unexpected private directory access')
        }
        $found[$rule.IdentityReference.Value] = $true
    }
    if (-not $found.ContainsKey($sid.Value) -or -not $found.ContainsKey($system.Value)) {
        throw [IO.IOException]::new('Required private directory access missing')
    }
    exit 0
} catch {
    # Only fixed stage names, exception types and numeric OS errors cross IPC.
    # Never return a profile path, account name or configuration contents.
    $errorObject = $_.Exception.GetBaseException()
    [Console]::Out.WriteLine(('TUZI_ACL_ERROR|{0}|{1:X8}|{2}' -f $stage, $errorObject.HResult, $errorObject.GetType().Name))
    exit 1
}
