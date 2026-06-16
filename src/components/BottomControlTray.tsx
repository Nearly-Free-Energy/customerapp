type BottomControlTrayProps = {
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  canNavigateNext: boolean;
  onSync?: () => void;
  isSyncing?: boolean;
  lastSyncedAt?: string | null;
};

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function BottomControlTray({
  label,
  onPrevious,
  onNext,
  canNavigateNext,
  onSync,
  isSyncing = false,
  lastSyncedAt,
}: BottomControlTrayProps) {
  return (
    <section className="bottom-tray" aria-label="Bottom calendar controls">
      <div className="bottom-tray__group bottom-tray__group--period">
        <div className="bottom-tray__caption">Browse period</div>
        <div className="bottom-period-nav">
          <button
            type="button"
            className="bottom-period-nav__button"
            onClick={onPrevious}
            aria-label="Previous period"
          >
            ‹
          </button>
          <div className="bottom-period-nav__label">{label}</div>
          <button
            type="button"
            className="bottom-period-nav__button"
            onClick={onNext}
            aria-label="Next period"
            disabled={!canNavigateNext}
          >
            ›
          </button>
        </div>
      </div>

      {onSync ? (
        <div className="bottom-tray__group bottom-tray__group--sync">
          <div className="bottom-tray__caption">
            {lastSyncedAt ? `Updated ${formatRelativeTime(lastSyncedAt)}` : 'Meter data'}
          </div>
          <button
            type="button"
            className={`sync-button${isSyncing ? ' sync-button--syncing' : ''}`}
            onClick={onSync}
            disabled={isSyncing}
            aria-label={isSyncing ? 'Syncing latest meter data' : 'Sync latest meter data'}
            title={isSyncing ? 'Syncing latest meter data' : 'Sync latest meter data'}
          >
            <svg
              className="sync-button__icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M20 6v5h-5" />
              <path d="M4 18v-5h5" />
              <path d="M17.7 9A6 6 0 0 0 7.8 6.8L4 10.5" />
              <path d="M6.3 15A6 6 0 0 0 16.2 17.2L20 13.5" />
            </svg>
          </button>
        </div>
      ) : null}
    </section>
  );
}
