import { createOpenEmsClient, findEnergyChannelCandidates, OpenEmsError } from './openems-client.js';
import { addIsoDays, formatDateInTimeZone } from './openems-sync.js';
import { createServerSupabaseClient } from './supabase-admin.js';

export async function discoverOpenEmsMeter(input, options = {}) {
  const client = options.client ?? createServerSupabaseClient();
  const openEmsClient = options.openEmsClient ?? createOpenEmsClient();
  const timezone = input.timezone ?? 'Africa/Kampala';
  const today = formatDateInTimeZone(options.now ?? new Date(), timezone);
  const edgeIds = input.edgeIds?.filter(Boolean) ?? [];

  if (!input.meterId?.trim()) throw new Error('A meter ID is required for OpenEMS discovery.');
  if (edgeIds.length === 0) throw new Error('At least one OpenEMS Edge ID is required for discovery.');

  const validatedCandidates = [];
  for (const edgeId of edgeIds) {
    const edgeConfig = await openEmsClient.getEdgeConfig(edgeId);
    const candidates = input.channel
      ? [{ address: input.channel, unit: findChannelUnit(edgeConfig, input.channel), score: 1000 }]
      : findEnergyChannelCandidates(edgeConfig, input.meterId);

    for (const candidate of candidates) {
      if (!['wh', 'kwh'].includes(candidate.unit.toLowerCase())) continue;
      try {
        const readings = await openEmsClient.queryDailyEnergy({
          edgeId,
          channel: candidate.address,
          fromDate: addIsoDays(today, -30),
          toDate: today,
          timezone,
        });
        const values = readings.filter((reading) => typeof reading.value === 'number' && reading.value >= 0);
        if (values.length > 0) {
          validatedCandidates.push({ ...candidate, edgeId, sampleDays: values.length, latestValue: values.at(-1).value });
        }
      } catch {
        // Candidate probing is best-effort; invalid historic channels are excluded.
      }
    }
  }

  const selected = selectUnambiguousCandidate(validatedCandidates);
  if (!selected) {
    return { meterId: input.meterId, saved: false, selected: null, candidates: validatedCandidates };
  }
  if (selected.unit.toLowerCase() !== 'wh') {
    throw new OpenEmsError(
      `The selected channel ${selected.address} uses ${selected.unit}; this integration currently requires Wh.`,
      'INVALID_UNIT',
    );
  }

  const { data, error } = await client
    .from('meter_sources')
    .update({
      source_type: 'openems',
      openems_edge_id: selected.edgeId,
      openems_energy_channel: selected.address,
      timezone,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('meter_id', input.meterId.trim())
    .select('id, utility_service_id, meter_id, openems_edge_id, openems_energy_channel, timezone')
    .maybeSingle();

  if (error) throw new Error(`Unable to save the OpenEMS meter mapping: ${error.message}`);
  if (!data) throw new Error(`No meter source exists for meter ${input.meterId}.`);

  return { meterId: input.meterId, saved: true, selected, mapping: data, candidates: validatedCandidates };
}

function findChannelUnit(edgeConfig, address) {
  const [componentId, channelId] = address.split('/');
  const unit = edgeConfig?.components?.[componentId]?.channels?.[channelId]?.unit;
  return typeof unit === 'string' ? unit : '';
}

function selectUnambiguousCandidate(candidates) {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((left, right) => right.score - left.score || right.sampleDays - left.sampleDays);
  if (sorted.length === 1) return sorted[0];
  return sorted[0].score > sorted[1].score ? sorted[0] : null;
}
