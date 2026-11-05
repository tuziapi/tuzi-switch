import type { VideoShot } from '../../../services/video-analysis-service';

type VersionWithShots<TShot extends VideoShot> = {
  id: string;
  shots: TShot[];
};

type VersionedRecord<TShot extends VideoShot> = {
  activeVersionId?: string;
  editedShots?: TShot[];
};

export function updateActiveVersionShotsInRecord<
  TShot extends VideoShot,
  TVersion extends VersionWithShots<TShot>,
  TKey extends string,
  TRecord extends VersionedRecord<TShot> & Partial<Record<TKey, TVersion[]>>,
>(record: TRecord, versionsKey: TKey, updatedShots: TShot[]) {
  const patch: Partial<TRecord> = { editedShots: updatedShots } as Partial<TRecord>;
  const versions = record[versionsKey];
  if (record.activeVersionId && versions) {
    patch[versionsKey] = versions.map((version) =>
      version.id === record.activeVersionId ? { ...version, shots: updatedShots } : version
    ) as TRecord[TKey];
  }
  return patch;
}
