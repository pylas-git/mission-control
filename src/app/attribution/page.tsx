import { AttributionPanel } from '@/components/panels/attribution-panel'

export const metadata = {
  title: 'Attribution | ESCP',
}

export default function AttributionPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <AttributionPanel />
    </main>
  )
}
