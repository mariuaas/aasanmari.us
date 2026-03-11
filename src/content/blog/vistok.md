---
title: "Thinking outside the Patch"
description: "Thoughts on visual tokenization, BPE, and what an visual tokenizer could be."
pubDate: 2026-01-28
draft: false
---

To participate in the endless flogging of a dead horse, *transformers have become the de facto architecture for all but a few data modalities*, including images.
But a less commonly discussed nuance is how this family of models is fully contingent on the process of *tokenization*, which sort of determines the *smallest units of observation* the model is able to deal with.
In natural language, tokenizers are designed to compress text into morphemes and semantic subwords; minimal semantic units aligned with meaning. 
The corpus the model is to be trained on is first distilled into a vocabulary by mining for these subwords, and the model then assigns these tokens to feature vectors in service of the task, typically some autoregressive prediction in LLMs.
The origin of the term *tokenization* is quite interesting, and can be traced back to lexical analysis; i.e. *lexers* in compiler theory. 
Later, lexical analysis was adopted as an analysis tool for NLP, aiding researchers in decoupling subwords, prefixes, suffixes, and stems in grammar parsing. 
Sort of funny, since the transformer now acts as a sort of semantic compiler if we interpret that analogy more literally.

## Digression: iGPT → ViT

Eventually, the hoopla about the transformer in NLP reached the vision researchers. 
Surely they could find a way to adapt these new models to images?
In danger of overstating the precise chronology here; this loosely occured as follows: [OpenAI proposed iGPT](https://cdn.openai.com/papers/Generative_Pretraining_from_Pixels_V2.pdf), an autoregressive pixel-transformer for ICML 2020. 
The idea was to apply their GPT-2 model on images as pixel-sequences, with autoregressive modelling. 
Everything would then be *gravy* since their previous findings showed that GPT gained emergent semantic understanding from this prediction task.
The teams findings were good; the model could do inpainting, and was able to classify images resonably well.
Not State-of-the-Art level, but decent.

The downside was that this endevour turns out to be *very expensive indeed*, since pixels scale quadratically with image height or width.
Moreover, there were some issues on the effect of autoregression, since images are famously *not sequences*, so the model inherits a context that mimics [CRT style scanline rendering](https://en.wikipedia.org/wiki/Scanline_rendering).

Later, at ICLR in October 2020 [Dosovitskiy and chums at Google](https://arxiv.org/abs/2010.11929) demonstrated two key improvements with their **Vision Transformer** architecture:
- The bidirectional BERT-like approach made a lot more sense than the autoregressive pipeline in iGPT.
- Moving from pixels to patches improves image analysis, particularly classification.

Now, *I found that last part very interesting* since the conceptual leap can be traced to a different paradigm for **tokenization**. 
Essentially, the ViT team proposed something like replacing *character-level encoding* with *word-level encoding* for images.
This makes sense; a single pixel is not particularly informative on its own, but plays a part in a larger contextual understanding of a scene. 
Additionally, you could now have State-of-the-Art transformers with competitive compute to more classical CNNs. 

After the ViT was introduced, visual tokenization generally took on a form of *partitioning* images into uniform square patches. 
But this generally ignores any intrinsic structure, semantic content and object boundaries in favor of the benefits of *computational convenience*. 
In other words, there is some incongruity at play; text tokenizers align with semantic units while patch-based vision tokenizers fragment objects without regard for their structure. 

I have spent some effort arguing that visual tokenization should more closely resemble the process in natural language; at the very least be a decision when training and developing models. 
Ideally, the process should be learnable, letting the model discover a discrete set of regions of semantically coherent regions from a continuous, high-dimensional image. 
Of course, this needs to happen under strict compute and memory budgets, effectively solving segmentation, compression and representation learning all at once.

## Byte Pair Encoding (BPE)

So, the claim is that vision is somehow harder than language. 
Let’s briefly look at how tokenization works in natural language first, to build some intuition for why this might be the case.
Byte Pair Encoding (BPE) is a commonly used tokenizer  that operates on a the byte level, which makes it invariant to the choice of encoding format, with the caveat that malformed tokens can occur in the vocuabulary. 
BPE and character level encoding works very similarly, so for the purposes of illustration, let us just ignore the details for now.
Sequential tokenizers can be considered as acting on a **path graph** $G = (V,E)$, where the graph is iteratively compressed with edge contraction.
This graph formulation is not standard, but it helps us later when we extend this approach to spatial graphs.

We start with a sequence of symbols drawn from an alphabet $\Sigma$.
Given a current tokenization $\sigma : V \to \Sigma$, BPE identifies the most frequent adjacent symbol pair
$$
(a^*, b^*) = \arg\max_{a,b \in \Sigma} \left| \sigma^{-1}(a,b) \right|.
$$
This pair is merged into a new symbol $a \oplus b$ (here $\oplus$ denotes concatenation), inducing a new alphabet
$$
\Sigma^{(t+1)} = \Sigma^{(t)} \cup (a^* \oplus b^*),
$$
and a new partitioning obtained by replacing all occurrences of $(a^*,b^*)$.
Each merge reduces sequence length while preserving the ability to reconstruct the original text.
At a high level, BPE is a greedy compression algorithm: it repeatedly collapses structure that appears frequently, trading expressivity for a more compact representation.

## From Sequences to Images

Images differ from text in one crucial respect: they are not sequences, but spatial fields.
Concretely, this spatial structure complicates matters; text (by virtue of being 1D sequences) can boast of a *natural canonical ordering* where breakpoints can be selected by cues such as whitespace and morpheme statistics. 
Partitioning spatial data effectively is not as easy however, and this is best illustrated with an example.




as opposed to 1D sequences, where one has a natural ordering and can pick breakpoints by cues such as whitespace and morpheme statistics, paritioning with spatial data is rather more complicated, and hence requires more thoughtful solutions. 



There is no canonical ordering of pixels, and adjacency is two-dimensional.

Instead of adjacent symbols in a string, an image induces a graph
$G = (V,E)$,
where vertices correspond to pixels and edges connect spatial neighbors.
Each edge $(i,j) \in E$ carries a weight $\kappa(i,j)$ measuring local similarity.

Tokenization then becomes a problem of *graph contraction*.
At each step, every vertex selects its strongest neighbor
$$
j^*(i) = \arg\max_{j \in \mathcal N(i)} \kappa(i,j),
$$
forming a set of candidate edges
$$
E_{\max} = \{(i, j^*(i)) : i \in V\}.
$$
Contracting these edges produces a coarser graph
$$
G^{(t+1)} = G^{(t)} / E_{\max},
$$
where each node now represents a region rather than a pixel.
Features are aggregated over the contracted sets.

This procedure plays the same role as BPE:
frequent or strongly agreeing structures are merged first,
progressively reducing the number of tokens.
