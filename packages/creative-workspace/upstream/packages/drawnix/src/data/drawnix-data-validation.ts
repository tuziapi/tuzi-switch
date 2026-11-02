import { DrawnixExportedData, DrawnixExportedType } from './types';

export const isValidDrawnixData = (
  data?: unknown
): data is DrawnixExportedData => {
  const record = data as Partial<DrawnixExportedData> | undefined;
  return (
    !!record &&
    record.type === DrawnixExportedType.drawnix &&
    Array.isArray(record.elements) &&
    typeof record.viewport === 'object'
  );
};
