export function formatEnumLabel(value: string): string {
  return value
    .split('_')
    .map(part => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}
