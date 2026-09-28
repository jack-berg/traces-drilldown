export type SemconvStability = 'stable' | 'release_candidate' | 'development' | 'alpha';

export interface SemconvMember {
  id: string;
  value: string;
  brief: string;
  stability: string;
}

export interface SemconvAttribute {
  name: string;
  namespace: string;
  type: string;
  brief: string;
  note?: string;
  examples?: string[];
  stability: SemconvStability;
  members?: SemconvMember[];
}
