const belts = [
  { level: 0, name: 'White', color: 'bg-white border border-gray-300 text-gray-800' },
  { level: 1, name: 'Yellow', color: 'bg-yellow-300 text-yellow-900' },
  { level: 2, name: 'Orange', color: 'bg-orange-400 text-white' },
  { level: 3, name: 'Green', color: 'bg-green-600 text-white' },
  { level: 4, name: 'Blue', color: 'bg-blue-600 text-white' },
  { level: 5, name: 'Purple', color: 'bg-purple-600 text-white' },
  { level: 6, name: 'Red', color: 'bg-red-600 text-white' },
  { level: 7, name: 'Brown', color: 'bg-amber-800 text-white' },
  { level: 8, name: 'Black', color: 'bg-gray-900 text-white' },
]

export function AttributionPanel() {
  return (
    <div className="p-6 w-full max-w-3xl mx-auto space-y-10">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Attribution</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Open-source frameworks and licenses used by the security belt system.
        </p>
      </div>

      <section>
        <h2 className="text-base font-semibold mb-3">Security Belts Framework</h2>
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <p>
            The belt levels and security requirement structure used in this application are derived from the{' '}
            <a href="https://github.com/AppSecure-nrw/security-belts" target="_blank" rel="noopener noreferrer" className="underline text-primary hover:opacity-80">
              Security Belts
            </a>{' '}
            project by{' '}
            <a href="https://appsecure.nrw" target="_blank" rel="noopener noreferrer" className="underline text-primary hover:opacity-80">
              AppSecure NRW
            </a>.
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted-foreground">License</dt>
            <dd>
              <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer" className="underline text-primary hover:opacity-80">
                Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
              </a>
            </dd>
            <dt className="text-muted-foreground">Source</dt>
            <dd>
              <a href="https://github.com/AppSecure-nrw/security-belts" target="_blank" rel="noopener noreferrer" className="underline text-primary hover:opacity-80">
                github.com/AppSecure-nrw/security-belts
              </a>
            </dd>
          </dl>

          <div>
            <p className="text-sm text-muted-foreground mb-3">Belt levels (white → black):</p>
            <div className="flex flex-wrap gap-2">
              {belts.map((belt) => (
                <span key={belt.level} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${belt.color}`}>
                  <span className="opacity-60">L{belt.level}</span>
                  {belt.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold mb-3">Modifications</h2>
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground space-y-2">
          <p>
            The requirement titles and descriptions stored in this application represent an internal snapshot based on the upstream framework. Some belt levels have been extended or authored by the Endava Security Champion Program team to fill gaps not covered by the upstream repository.
          </p>
          <p>
            Full upstream descriptions are available at the source repository linked above. This application links to external course and lab content but does not host that content directly.
          </p>
        </div>
      </section>
    </div>
  )
}