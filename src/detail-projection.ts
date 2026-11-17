/** Connect the model's projected surface to a floating document in stage space. */
export class DetailProjection {
  private beam: SVGPathElement;
  private rays: SVGPathElement;
  private source: SVGCircleElement;
  private first = [0, 0];
  private second = [0, 0];
  private portrait = false;
  private previous = "";

  constructor(
    private stage: HTMLElement,
    private panel: HTMLElement,
    private svg: SVGSVGElement,
  ) {
    this.beam = svg.querySelector(".projection-beam")!;
    this.rays = svg.querySelector(".projection-rays")!;
    this.source = svg.querySelector(".projection-source")!;
  }

  // Only measure when opening or resizing, never in the animation loop.
  fit() {
    this.svg.setAttribute("viewBox", `0 0 ${this.stage.clientWidth} ${this.stage.clientHeight}`);
    this.portrait = this.stage.dataset.layout === "portrait";
    const { offsetLeft: x, offsetTop: y, offsetWidth: width, offsetHeight: height } = this.panel;
    this.first = this.portrait ? [x + width * 0.18, y] : [x, y + height * 0.18];
    this.second = this.portrait ? [x + width * 0.82, y] : [x, y + height * 0.82];
    this.previous = "";
  }

  render(project: (x: number, y: number) => number[]) {
    // The emitter stays on the model surface as the disk rises and returns.
    const [x, y] = project(0, 2.6);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const point = (p: number[]) => p.map(value => value.toFixed(1)).join(" ");
    const start = point(this.portrait ? [x - 5, y] : [x, y - 5]);
    const end = point(this.portrait ? [x + 5, y] : [x, y + 5]);
    const first = point(this.first), second = point(this.second);
    const shape = `M${start} L${first} L${second} L${end} Z`;
    if (shape === this.previous) return;
    this.previous = shape;
    this.beam.setAttribute("d", shape);
    this.rays.setAttribute("d", `M${start} L${first} M${end} L${second}`);
    this.source.setAttribute("cx", x.toFixed(1));
    this.source.setAttribute("cy", y.toFixed(1));
  }
}
