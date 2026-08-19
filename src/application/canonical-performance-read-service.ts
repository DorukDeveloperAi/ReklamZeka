import { buildCanonicalPerformanceReadModel, type CanonicalPerformanceReadProjection, type PerformanceSource } from "@/domain/meta/performance-read-model";
export type CanonicalPerformanceReadRepository = Readonly<{ load(workspaceId: string): Promise<readonly PerformanceSource[]> }>;
export class CanonicalPerformanceReadService { constructor(private readonly repository: CanonicalPerformanceReadRepository) {} async read(workspaceId: string): Promise<CanonicalPerformanceReadProjection> { return buildCanonicalPerformanceReadModel(await this.repository.load(workspaceId), workspaceId); } }
