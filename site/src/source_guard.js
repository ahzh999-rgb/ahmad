const KINDS = new Set(['OFFICIAL_SNAPSHOT', 'OWNER_ACCEPTED']);
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
