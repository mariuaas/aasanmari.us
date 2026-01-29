---
title: "On the role of tokenization in vision models"
description: "Some notes on tokenization, BPE, and what an visual tokenizer could be."
pubDate: 2026-01-28
draft: false
---

As we all know, the transformer has become the de facto architecture for all but a few data modalities, including images.
The architecture is contingent on the process of *tokenization*, which determines the *atomic units of observation* the model deals with.
In natural language, tokenizers are designed to compress text into morphemes and semantic subwords; minimal semantic units aligned with meaning.
The origin of the term *tokenization* is quite interesting, and can be traced back to lexical analysis; i.e. *lexers* in compiler theory, which --- by my limited understanding --- was adopted as an analysis tool in NLP to decouple subwords, prefixes, suffixes, and stems to grammar parsing. The order may be wholly reversed, however, these origins are fundamentally interesting.

Now, in vision models, tokenization generally appears as a process of *partitioning* images into uniform square patches. 
This generally ignores any intrinsic structure, semantic content and object boundaries in favor of the benefits of *computational convenience*. 
In other words, there is some incongruity at play; text tokenizers align with semantic units while patch-based vision tokenizers fragment objects without regard for their structure. 

From my perspective, I'd argue that visual tokenization should more closely resemble the process in natural language. be a process of discovering a discrete set of regions from a continuous, high-dimensional image. 
Of course, this needs to happen under strict compute and memory budgets, effectively solving segmentation, compression and representation learning all at once.
If this wasn't enough, the spatial structure of images complicates matters; as opposed to 1D sequences, where one has a natural ordering and can pick breakpoints by cues such as whitespace and morpheme statistics, paritioning with spatial data is rather more complicated, and hence requires more thoughtful solutions. 

## Byte Pair Encoding (BPE)

Let’s briefly look at how tokenization works in natural language.
A common choice is Byte Pair Encoding (BPE), which constructs a tokenizer by iteratively compressing redundancy.

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
