export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DesignDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  remediation?: string;
  nodeId?: string;
  edgeId?: string;
  endpointId?: string;
  fieldName?: string;
  stepId?: string;
  routeId?: string;
  tableName?: string;
  columnName?: string;
  topicName?: string;
  profileName?: string;
}

export interface CompileResult {
  ok: boolean;
  diagnostics: DesignDiagnostic[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}