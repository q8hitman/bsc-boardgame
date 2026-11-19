/** The running ducks across the grass under the logo: four club characters on their run cycle (the 4 stride frames
 *  of their extra strip), drifting across with a ball. Plain CSS animation; a still line-up under reduced motion. */

const RUNNERS = ["fayzah", "ahmad", "tima", "ali"];

export function runnersHtml(): string {
  const ducks = RUNNERS.map(
    (c, i) => `<i class="runner" style="--i:${i};background-image:url(assets/football/extra/${c}-blue.png)"></i>`,
  ).join("");
  return `<div class="runners" aria-hidden="true"><div class="field"><i class="lines"></i></div>${ducks}<i class="ball"></i></div>`;
}
