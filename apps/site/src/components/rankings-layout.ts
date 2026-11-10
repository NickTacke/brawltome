// the same side padding as the guild and player pages
// halved outside the inner max: the css minifier would fold the half into 37.78125rem and round it, which moves the
// page by a pixel in safari
export const rankingPageStyle = 'md:px-[max(0px,calc(2.5rem-max(0px,100vw-75.5625rem)/2))]'
