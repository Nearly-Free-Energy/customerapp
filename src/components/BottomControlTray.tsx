type BottomControlTrayProps = {
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  canNavigateNext: boolean;
};

export function BottomControlTray({
  label,
  onPrevious,
  onNext,
  canNavigateNext,
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
    </section>
  );
}
