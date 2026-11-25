// SESSION LENGTH HISTOGRAM
// Purpose: buckets session lengths into equal width bins for the machine page chart

export interface bin {
  from: number // inclusive
  to: number // exclusive, the last bin also takes everything above it
  count: number
}

// picks the first nice width from steps that fits the 95th percentile in maxBins bins
// so one really long session doesnt stretch the whole chart, outliers go in the last bin
export function histogram(values: readonly number[], steps: readonly number[], maxBins = 12): bin[] {
  if (values.length === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  const width = steps.find((w) => Math.ceil((p95 + 1e-9) / w) <= maxBins) ?? steps[steps.length - 1]
  const n = Math.max(1, Math.min(maxBins, Math.ceil((p95 + 1e-9) / width)))
  const bins: bin[] = Array.from({ length: n }, (_, i) => ({ from: i * width, to: (i + 1) * width, count: 0 }))
  for (const v of values) bins[Math.min(n - 1, Math.max(0, Math.floor(v / width)))].count++
  return bins
}
