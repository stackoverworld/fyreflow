export type RecordValueSetter<TValue> = (
  updater: (current: Record<string, TValue>) => Record<string, TValue>
) => void;

export function setRecordValueAction<TValue>(setter: RecordValueSetter<TValue>, key: string, value: TValue): void {
  setter((current) => ({
    ...current,
    [key]: value
  }));
}
