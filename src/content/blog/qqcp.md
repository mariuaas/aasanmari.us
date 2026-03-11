---
title: "Quantized Quadrahedral Color Palettes"
description: "Some thoughts on color quantization and compression."
pubDate: 2026-01-28
draft: false
---

Ever since I started working with computer vision, I had a strange draw to color theory and quantization.
My current understanding of myself leads me to believe that this is largely due to the observation that color theory 
seems strangely disjoint from modern vision pipelines, but played a huge part in classic computing and retro gaming, 
which somehow shaped my early understanding of what imaging meant in a computational setting.
So nostalgia plays a part, but also the aesthetics of minimalism. 


While it plays a less prominent role in the understanding of AI models, there are literally dozens of existing color
spaces, each with their own quirks and personalities, and I very much enjoy playing around with them when I have the
time. Sometimes, I seem to make the time if I am sufficiently driven by other factors, which has happened a few times
during my PhD. 

## Statistical Independence

There are several interesting color spaces designed for independence of chromacity and luminosity. The canonical example
comes from the bog-standard HSV; the goto for color-picking in web and most graphical UI interfaces.

...

When I first learned of YCbCr as a digital variant of the analog YPbPr format, I was intrigued by its properties as a
sidecar to luminance based *black-and-white* TV signals, proposed by a certain 
[Monsieur Valensi](https://en.wikipedia.org/wiki/Georges_Valensi) back in 1938. 

...

## Fixing YCbCr

While I found YCbCr intriguing, I felt the format was sort of overengineered. Several standards were created, mostly
for optimizing television broadcasting in various ways. However, it didn't make sense that a sort of statistical 
independence — the property useful for chroma subsampling — was tied to the specific hues decided by Monsieur Valensi. 
Given that cameras largely make use of [Bayer filters](https://en.wikipedia.org/wiki/Bayer_filter) on CCD sensors, 
it seemed natural that the RGB values should at least reflect the distribution induced by the sensor, i.e.

$$
\frac{1}{4}R + \frac{1}{2}G + \frac{1}{4}B
$$

...

## Quadrahedral Quantized Color Palette

<div class="not-prose">
  <div id="sobol-quantizer-app"></div>
</div>

<script type="module">
  import { mount } from "/sobolquantizer.js";

  const element = document.getElementById("sobol-quantizer-app");
  if (element) mount(element);
</script>