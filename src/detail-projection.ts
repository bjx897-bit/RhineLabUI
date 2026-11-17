// The GLB cover spans x=-2.5..2.5, y=0..3.7. Keep its local clockwise
// order rather than sorting screen positions, which can swap corners in perspective.
const CORNERS = [
  { name: "top-left", x: -2.5, y: 3.7 },
  { name: "top-right", x: 2.5, y: 3.7 },
  { name: "bottom-right", x: 2.5, y: 0 },
  { name: "bottom-left", x: -2.5, y: 0 },
] as const;
const SIDES = ["top", "right", "bottom", "left"] as const;

/** Connect the model's four surface corners to a document in stage space. */
export class DetailProjection {
  private beams: SVGPathElement[];
  private rays: SVGLineElement[];
  private targets: number[][] = [];
  private previous = "";

  constructor(
    private stage: HTMLElement,
    private panel: HTMLElement,
    private svg: SVGSVGElement,
  ) {
    this.beams = SIDES.map((side) =>
      svg.querySelector<SVGPathElement>(
        `.projection-beam[data-side="${side}"]`,
      )!,
    );
    this.rays = CORNERS.map(({ name }) =>
      svg.querySelector<SVGLineElement>(
        `.projection-ray[data-corner="${name}"]`,
      )!,
    );
  }

  // Only measure when opening or resizing, never in the animation loop.
  fit() {
    this.svg.setAttribute(
      "viewBox",
      `0 0 ${this.stage.clientWidth} ${this.stage.clientHeight}`,
    );
    const {
      offsetLeft: x,
      offsetTop: y,
      offsetWidth: width,
      offsetHeight: height,
    } = this.panel;
    this.targets = [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ];
    this.previous = "";
  }

  render(project: (x: number, y: number) => number[]) {
    if (this.targets.length !== CORNERS.length) return;
    // The caller projects the actual front surface (z=0.206), without moving
    // sources toward the panel or clamping them to screen bounds.
    const sources = CORNERS.map(({ x, y }) => project(x, y));
    if (sources.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)))
      return;
    const format = ([x, y]: number[]) => [x.toFixed(1), y.toFixed(1)];
    const starts = sources.map(format);
    const signature = starts.map((point) => point.join(" ")).join(";");
    if (signature === this.previous) return;
    this.previous = signature;
    const ends = this.targets.map(format);
    this.rays.forEach((ray, index) => {
      const [x1, y1] = starts[index];
      const [x2, y2] = ends[index];
      ray.setAttribute("x1", x1);
      ray.setAttribute("y1", y1);
      ray.setAttribute("x2", x2);
      ray.setAttribute("y2", y2);
    });
    // Separate faces must paint independently. Combining their oppositely
    // wound subpaths cancels the light between the model and the document.
    this.beams.forEach((beam, index) => {
      const next = (index + 1) % CORNERS.length;
      beam.setAttribute(
        "d",
        `M${starts[index].join(" ")} L${ends[index].join(" ")} L${ends[next].join(" ")} L${starts[next].join(" ")} Z`,
      );
    });
  }
}
