/**
 * Mapping from mixed `company_documents` rows to Document vs File (#115).
 * Combined HTTP still reads `company_documents`; File rows live in `files`.
 */

export function isUploadedFile(row: { storagePath?: string | null }): boolean {
  return Boolean(row.storagePath);
}
