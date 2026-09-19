import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWebResults, webResultsInstructions } from './webSearch.mjs'

test('extracts results from DuckDuckGo lite HTML with redirect links', () => {
  const html = `
  <tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&rut=xyz" class='result-link'>النتيجة الأولى</a></td></tr>
  <tr><td class='result-snippet'>وصف أول <b>مميز</b></td></tr>
  <tr><td><a rel="nofollow" href="https://direct.com/b" class='result-link'>Second result</a></td></tr>
  <tr><td class='result-snippet'>Plain snippet</td></tr>`
  const results = parseWebResults(html)
  assert.equal(results.length, 2)
  assert.equal(results[0].url, 'https://example.com/a')
  assert.equal(results[0].title, 'النتيجة الأولى')
  assert.equal(results[0].snippet, 'وصف أول مميز')
  assert.equal(results[1].url, 'https://direct.com/b')
  assert.equal(results[1].snippet, 'Plain snippet')
})

test('ignores duplicate and non-http links', () => {
  const html = `
  <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa" class='result-link'>أولى</a>
  <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa" class='result-link'>مكررة</a>
  <a href="javascript:void(0)" class='result-link'>برمجية</a>`
  const results = parseWebResults(html)
  assert.equal(results.length, 1)
  assert.equal(results[0].url, 'https://example.com/a')
})

test('formats web results as numbered instructions', () => {
  const text = webResultsInstructions([{ url: 'https://example.com/a', title: 'النتيجة', snippet: 'وصف' }])
  assert.match(text, /نتائج بحث ويب فعلية/)
  assert.match(text, /1\. النتيجة/)
  assert.match(text, /وصف/)
  assert.match(text, /https:\/\/example\.com\/a/)
})
