import * as React from "react";
import { Input, type InputProps } from "@/components/ui/input";

export interface ImeSafeInputProps
  extends Omit<InputProps, "defaultValue" | "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
  normalize?: (value: string) => string;
}

const ImeSafeInput = React.forwardRef<HTMLInputElement, ImeSafeInputProps>(
  (
    {
      value,
      onValueChange,
      normalize,
      onBlur,
      onCompositionStart,
      onCompositionEnd,
      ...props
    },
    ref,
  ) => {
    const composingRef = React.useRef(false);
    const externalValueRef = React.useRef(value);
    const [draft, setDraft] = React.useState(value);

    React.useEffect(() => {
      externalValueRef.current = value;
      if (!composingRef.current) setDraft(value);
    }, [value]);

    const commit = React.useCallback(
      (rawValue: string) => {
        const nextValue = normalize ? normalize(rawValue) : rawValue;
        setDraft(nextValue);
        if (nextValue !== externalValueRef.current) {
          externalValueRef.current = nextValue;
          onValueChange(nextValue);
        }
      },
      [normalize, onValueChange],
    );

    return (
      <Input
        {...props}
        ref={ref}
        value={draft}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          if (composingRef.current) {
            setDraft(nextValue);
          } else {
            commit(nextValue);
          }
        }}
        onBlur={(event) => {
          if (composingRef.current) {
            composingRef.current = false;
            commit(event.currentTarget.value);
          } else {
            externalValueRef.current = value;
            setDraft(value);
          }
          onBlur?.(event);
        }}
        onCompositionStart={(event) => {
          composingRef.current = true;
          setDraft(event.currentTarget.value);
          onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          commit(event.currentTarget.value);
          onCompositionEnd?.(event);
        }}
      />
    );
  },
);

ImeSafeInput.displayName = "ImeSafeInput";

export { ImeSafeInput };
