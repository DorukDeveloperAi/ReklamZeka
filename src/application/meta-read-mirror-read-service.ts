import type { MetaReadMirrorProjection } from "@/domain/meta/read-mirror-projection";

export type MetaReadMirrorReadRepository = Readonly<{
  load(workspaceId: string): Promise<MetaReadMirrorProjection>;
}>;

/** Read-only application boundary; no refresh, Graph call, action, or policy mutation is available here. */
export class MetaReadMirrorReadService {
  constructor(private readonly repository: MetaReadMirrorReadRepository) {}

  read(workspaceId: string): Promise<MetaReadMirrorProjection> {
    return this.repository.load(workspaceId);
  }
}
