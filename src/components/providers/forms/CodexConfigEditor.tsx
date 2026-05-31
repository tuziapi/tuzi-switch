import React from "react";
import { CodexConfigSection } from "./CodexConfigSections";

interface CodexConfigEditorProps {
  authValue: string;

  configValue: string;

  onAuthChange: (value: string) => void;

  onConfigChange: (value: string) => void;

  onAuthBlur?: () => void;

  useCommonConfig: boolean;

  onCommonConfigToggle: (checked: boolean) => void;

  commonConfigSnippet: string;

  onCommonConfigSnippetChange: (value: string) => boolean;

  onCommonConfigErrorClear: () => void;

  commonConfigError: string;

  authError: string;

  configError: string; // config.toml 错误提示

  onExtract?: () => void;

  isExtracting?: boolean;
}

const CodexConfigEditor: React.FC<CodexConfigEditorProps> = ({
  configValue,
  onConfigChange,
  configError,
}) => {
  return (
    <div className="space-y-6">
      {/* Config TOML Section (auth.json and common config are no longer needed) */}
      <CodexConfigSection
        value={configValue}
        onChange={onConfigChange}
        useCommonConfig={false}
        onCommonConfigToggle={() => {}}
        onEditCommonConfig={() => {}}
        commonConfigError=""
        configError={configError}
      />
    </div>
  );
};

export default CodexConfigEditor;
