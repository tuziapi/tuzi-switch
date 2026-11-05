import React from 'react';

export interface WorkflowStepConfig<TStepId extends string> {
  id: TStepId;
  label: string;
  disabled?: boolean;
}

export interface WorkflowStepBarProps<TStepId extends string> {
  current: string;
  steps: readonly WorkflowStepConfig<TStepId>[];
  onNavigate: (page: TStepId) => void;
}

export function WorkflowStepBar<TStepId extends string>({
  current,
  steps,
  onNavigate,
}: WorkflowStepBarProps<TStepId>): React.ReactElement {
  const currentIndex = steps.findIndex((step) => step.id === current);

  return (
    <div className="va-step-bar">
      {steps.map((step, index) => {
        const isActive = step.id === current;
        const isPast = index < currentIndex;
        const isDisabled = !!step.disabled;

        return (
          <React.Fragment key={step.id}>
            {index > 0 && <span className="va-step-arrow">→</span>}
            <button
              className={`va-step ${isActive ? 'active' : ''} ${
                isPast ? 'past' : ''
              }`}
              onClick={() => {
                if (!isDisabled) {
                  onNavigate(step.id);
                }
              }}
              disabled={isDisabled}
            >
              <span className="va-step-num">{index + 1}</span>
              {step.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
