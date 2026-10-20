const KINDS = new Set(['OFFICIAL_SNAPSHOT', 'OWNER_ACCEPTED']);
export async function sha256(raw) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function checkedCatalog(raw, manifest) {
  if (!/^[a-f0-9]{64}$/.test(manifest.data_sha256 || '') || await sha256(raw) !== manifest.data_sha256) throw new Error('source_integrity');
  const data = JSON.parse(raw);
  if (data.snapshot !== manifest.commit || data.repository !== manifest.repository || !Array.isArray(data.docs)) throw new Error('source_integrity');
  const count = data.docs.reduce((n,d) => n + (Array.isArray(d.secs) ? d.secs.length : 0), 0);
  if (count !== manifest.section_count || data.docs.length !== manifest.document_count) throw new Error('source_integrity');
  return data;
}
export async function checkedSection(raw, manifest, id) {
  if (!manifest || manifest.schema_version !== 1 || !/^[a-f0-9]{40}$/.test(manifest.commit || '')) throw new Error('source_unavailable');
  const expected = manifest.section_sha256?.[String(id)];
  if (!expected) throw new Error('ineligible_source');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  if (hex !== expected) throw new Error('source_integrity');
  const section = JSON.parse(raw);
  if (section.eligible !== true || !KINDS.has(section.body_kind) || section.snapshot !== manifest.commit || typeof section.b !== 'string' || !section.b) throw new Error('ineligible_source');
  const bodyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(section.b));
  const bodyHex = [...new Uint8Array(bodyDigest)].map(x => x.toString(16).padStart(2, '0')).join('');
  if (bodyHex !== section.body_sha256) throw new Error('source_integrity');
  return section;
}

export async function checkedInventory(raw, manifest) {
  if (!/^[a-f0-9]{64}$/.test(manifest.library_inventory_sha256 || '') || await sha256(raw) !== manifest.library_inventory_sha256) throw new Error('source_integrity');
  const inventory = JSON.parse(raw);
  if (inventory.schema_version !== 1 || inventory.snapshot !== manifest.commit || inventory.repository !== manifest.repository || !Array.isArray(inventory.decisions) || !Array.isArray(inventory.gazette_issues) || inventory.answer_eligibility_changed !== false) throw new Error('source_integrity');
  return inventory;
}
