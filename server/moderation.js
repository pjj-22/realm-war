import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity'

// Built once - the matcher compiles the dataset + leetspeak/spacing
// transformers into regexes up front, so reuse it across requests rather
// than rebuilding per call.
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
})

export function containsBadWords(text) {
  return matcher.hasMatch(text)
}
