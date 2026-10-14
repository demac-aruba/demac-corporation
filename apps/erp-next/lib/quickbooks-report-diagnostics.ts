const details: Record<string, string> = {
  header_shape: 'encabezado', header_name: 'tipo de informe', header_currency: 'moneda',
  header_end_period: 'fecha de corte', header_start_period: 'fecha de inicio', header_basis: 'base contable',
  columns: 'columnas', column_shape: 'estructura de columnas', column_title: 'títulos de columnas', column_type: 'tipos de columnas',
  cell_count: 'cantidad de celdas', cell_value: 'contenido de celdas', row_limit: 'límite de filas', row_depth: 'niveles de filas',
  rows_shape: 'estructura de filas', row_shape: 'estructura de una fila', row_type: 'tipo de fila', header_options: 'opciones del informe',
  no_report_data: 'indicador de datos', missing_rows: 'filas ausentes', empty_rows: 'filas vacías', header_time: 'fecha de generación',
};
export function reportDiagnosticMessage(code: unknown, issue: unknown): string {
  if (code !== 'invalid-report-response' || typeof issue !== 'string' || !Object.hasOwn(details, issue)) return '';
  return ` Comprobación pendiente: ${details[issue]}. Referencia: ${issue}.`;
}
