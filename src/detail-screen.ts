type ScreenState = "closed" | "opening" | "open";

/** A single television-style opening, with no animation left running afterward. */
export class DetailScreen {
  private startup: HTMLElement;
  private animations: Animation[] = [];
  private revision = 0;
  private currentState: ScreenState = "closed";

  constructor(private root: HTMLElement) {
    this.startup = root.querySelector<HTMLElement>(".screen-startup")!;
    this.hide();
  }

  get visible() {
    return this.currentState !== "closed";
  }

  get state(): ScreenState {
    return this.currentState;
  }

  show(reduced: boolean, onReady: () => void) {
    if (this.visible) return;
    const revision = ++this.revision;
    this.root.hidden = false;
    this.root.inert = true;
    this.setState("opening");

    const complete = () => {
      if (revision !== this.revision) return;
      this.cancelAnimations();
      this.resetAppearance();
      this.root.inert = false;
      this.setState("open");
      onReady();
    };
    if (reduced) {
      complete();
      return;
    }

    const options: KeyframeAnimationOptions = {
      duration: 480,
      easing: "linear",
      fill: "both",
    };
    this.animations = [
      this.root.animate(
        [
          { offset: 0, clipPath: "inset(49.8% 45%)", opacity: 0 },
          { offset: 0.08, clipPath: "inset(49.8% 45%)", opacity: 1 },
          { offset: 0.26, clipPath: "inset(49.8% 0%)", opacity: 1 },
          {
            offset: 0.32,
            clipPath: "inset(49.8% 0%)",
            opacity: 1,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          },
          { offset: 0.8, clipPath: "inset(0% 0%)", opacity: 1 },
          { offset: 0.9, clipPath: "inset(0% 0%)", opacity: 0.96 },
          { offset: 1, clipPath: "inset(0% 0%)", opacity: 1 },
        ],
        options,
      ),
      this.startup.animate(
        [
          { offset: 0, opacity: 0 },
          { offset: 0.08, opacity: 1 },
          { offset: 0.26, opacity: 1 },
          { offset: 0.48, opacity: 0.32 },
          { offset: 0.8, opacity: 0.08 },
          { offset: 1, opacity: 0 },
        ],
        options,
      ),
    ];
    void Promise.all(
      this.animations.map((animation) => animation.finished),
    ).then(
      complete,
      () => {}, // hide() cancels these promises and owns the resulting state.
    );
  }

  hide() {
    this.revision++;
    this.root.hidden = true;
    this.root.inert = true;
    this.setState("closed");
    this.cancelAnimations();
    this.resetAppearance();
  }

  private setState(state: ScreenState) {
    this.currentState = state;
    this.root.dataset.screenState = state;
  }

  private cancelAnimations() {
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
  }

  private resetAppearance() {
    this.root.style.clipPath = "none";
    this.root.style.opacity = "1";
    this.startup.style.opacity = "0";
  }
}
