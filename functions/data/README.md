# Papiamento di Aruba vocabulary

`papiamento-aruba-vocabulary-2009.json` is a normalized searchable word index generated from the public **Vocabulario di Papiamento — Aruba 2009** published by Departamento di Enseñansa Aruba.

- Official source: https://www.ea.aw/pages/wp-content/uploads/pdf/doc-pub/p/papiamento_Vocabulario-di-Papiamento-2009.pdf
- Reference search site: https://papiamento.aw
- Orthography version: April 2009

Regenerate the index after obtaining the official PDF and running `pdftotext -layout`:

```bash
node scripts/buildPapiamentoArubaVocabulary.cjs vocabulary.txt functions/data/papiamento-aruba-vocabulary-2009.json
```

The index is used only to flag words for office review. It does not automatically overwrite translations, brands, model numbers, or HVAC terminology.
