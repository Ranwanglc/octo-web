import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import {
  HtmlDocView,
  resolveOctoDocBase,
  buildOctoDocUrl,
  sanitizeDocHtml,
} from './HtmlDocView.tsx'

// HtmlDocView fetches the published octo-doc HTML from a SEPARATE backend, so we stub the
// global fetch (not the octoweb apiClient) — mirroring the component's raw-fetch design.
function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(String(input), init)),
  ) as unknown as typeof fetch
  vi.stubGlobal('fetch', spy)
  return spy as unknown as ReturnType<typeof vi.fn>
}

function htmlResponse(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => body,
  } as unknown as Response
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

function selectNodeText(node: Node) {
  const range = document.createRange()
  range.selectNodeContents(node)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

beforeEach(() => {
  delete (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolveOctoDocBase / buildOctoDocUrl', () => {
  it('prefers the runtime window.__OCTO_DOC_BASE__ override (trailing slash trimmed)', () => {
    ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ =
      'https://octo-doc.example.com/'
    expect(resolveOctoDocBase()).toBe('https://octo-doc.example.com')
  })

  it('defaults to same-origin (empty base) when nothing is configured', () => {
    expect(resolveOctoDocBase()).toBe('')
  })

  it('builds the octo-doc read-only URL `<base>/d/{slug}/v/{version}`', () => {
    ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
    expect(buildOctoDocUrl('my-slug', 'v3')).toBe('https://od.test/d/my-slug/v/v3')
  })
})

describe('HtmlDocView — read-only rendering', () => {
  it('renders the published octo-doc HTML inline (fetched from the octo-doc backend)', async () => {
    ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
    const spy = stubFetch(() =>
      htmlResponse('<h1>Agent Report</h1><p>Generated content.</p>'),
    )

    render(<HtmlDocView docId="d_html_1" space="sp" />)

    await waitFor(() => expect(screen.getByText('Agent Report')).toBeTruthy())
    expect(screen.getByText('Generated content.')).toBeTruthy()
    // Addressed the octo-doc read-only surface, not the /api/v1 docs backend.
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/d/d_html_1/v/latest')
    // Cross-origin session cookie must ride along.
    expect(spy.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('uses an explicit slug + version when provided', async () => {
    const spy = stubFetch(() => htmlResponse('<p>ok</p>'))
    render(<HtmlDocView docId="d1" space="sp" slug="published-slug" version="v7" />)
    await waitFor(() => expect(screen.getByText('ok')).toBeTruthy())
    expect(String(spy.mock.calls[0][0])).toBe('/d/published-slug/v/v7')
  })

  it('shows a loading state before the fetch resolves', async () => {
    let resolve!: (r: Response) => void
    stubFetch(() => new Promise<Response>((r) => (resolve = r)))
    render(<HtmlDocView docId="d1" space="sp" />)
    // Loading placeholder present while pending.
    expect(screen.getByRole('status')).toBeTruthy()
    resolve(htmlResponse('<p>done</p>'))
    await waitFor(() => expect(screen.getByText('done')).toBeTruthy())
  })

  it('shows an error state when the fetch fails (non-ok)', async () => {
    stubFetch(() => htmlResponse('nope', false, 500))
    render(<HtmlDocView docId="d1" space="sp" />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  })

  it('shows an error state when the fetch rejects (network)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))) as unknown as typeof fetch,
    )
    render(<HtmlDocView docId="d1" space="sp" />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  })

  it('shows an empty state when octo-doc returns blank HTML', async () => {
    stubFetch(() => htmlResponse('   '))
    render(<HtmlDocView docId="d1" space="sp" />)
    await waitFor(() => expect(screen.getByText('docs.state.empty')).toBeTruthy())
  })

  it('is READ-ONLY: renders NO editing controls (product hard constraint)', async () => {
    stubFetch(() =>
      htmlResponse('<h1>Title</h1><p>Body text the human can read but not edit.</p>'),
    )
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitFor(() => expect(screen.getByText('Title')).toBeTruthy())

    // No form/edit affordances of any kind INSIDE THE RENDERED DOC CONTENT. (The 2b comment
    // rail is a separate overlay with its own controls; the read-only invariant is that the
    // agent-authored document content carries no editing chrome.)
    const content = container.querySelector('.octo-html-doc-content') as HTMLElement
    expect(content.querySelector('button')).toBeNull()
    expect(content.querySelector('input')).toBeNull()
    expect(content.querySelector('textarea')).toBeNull()
    // No toolbar / editable region.
    expect(content.querySelector('[contenteditable="true"]')).toBeNull()
    expect(content.querySelector('.ProseMirror')).toBeNull()
    expect(content.querySelector('[role="toolbar"]')).toBeNull()
  })

  it('SANITIZES the fetched HTML before inlining (strips a <script> from the payload)', async () => {
    stubFetch(() =>
      htmlResponse('<p>safe body</p><script>window.__pwned = 1</script>'),
    )
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitFor(() => expect(screen.getByText('safe body')).toBeTruthy())
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('__pwned')
  })

  it('strips interactive/editable controls injected into the payload (read-only hard rule)', async () => {
    stubFetch(() =>
      htmlResponse(
        '<p>ok</p><form><input value="x"><button>go</button><textarea></textarea></form><div contenteditable="true">edit me</div>',
      ),
    )
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitFor(() => expect(screen.getByText('ok')).toBeTruthy())
    // Interactive controls injected into the PAYLOAD are stripped from the rendered content
    // (the 2b comment overlay's own controls live outside .octo-html-doc-content).
    const content = container.querySelector('.octo-html-doc-content') as HTMLElement
    expect(content.querySelector('form')).toBeNull()
    expect(content.querySelector('input')).toBeNull()
    expect(content.querySelector('button')).toBeNull()
    expect(content.querySelector('textarea')).toBeNull()
    expect(content.querySelector('[contenteditable]')).toBeNull()
  })

  it('surfaces the attempted octo-doc URL in the error state (misconfig diagnostic)', async () => {
    ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
    stubFetch(() => htmlResponse('nope', false, 404))
    render(<HtmlDocView docId="dX" space="sp" />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText('https://od.test/d/dX/v/latest')).toBeTruthy()
  })

  it('lays out the sanitized content and comment panel in the ready body rail', async () => {
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ roots: [] })
      return htmlResponse('<p>body</p>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitFor(() => expect(screen.getByText('body')).toBeTruthy())

    const main = screen.getByTestId('html-doc-main')
    expect(main.querySelector('.octo-html-doc-content')).toBeTruthy()
    expect(main.querySelector('[data-testid="html-doc-comment-panel"]')).toBeTruthy()
    expect(container.querySelector('.octo-html-doc-header')).toBeTruthy()
  })

  it('keeps a selected anchor locked when selection collapses after focusing the comment input', async () => {
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ roots: [] })
      return htmlResponse('<p data-odoc-aid="a1">selected words</p>')
    })
    render(<HtmlDocView docId="d1" space="sp" />)
    const anchored = await screen.findByText('selected words')

    selectNodeText(anchored.firstChild ?? anchored)
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a1'))

    const input = screen.getByPlaceholderText('docs.comment.placeholder')
    fireEvent.focus(input)
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))

    expect(screen.getByTestId('pending-anchor').textContent).toContain('#a1')
  })

  it('clears the locked anchor only through the explicit target cancel action', async () => {
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ roots: [] })
      return htmlResponse('<p data-odoc-aid="a2">clearable words</p>')
    })
    render(<HtmlDocView docId="d1" space="sp" />)
    const anchored = await screen.findByText('clearable words')

    selectNodeText(anchored.firstChild ?? anchored)
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a2'))

    fireEvent.click(screen.getByText('docs.comment.clearAnchor'))

    expect(screen.getByTestId('pending-anchor').textContent).toContain('docs.comment.targetDoc')
    expect(screen.getByTestId('pending-anchor').textContent).not.toContain('#a2')
  })

  it('submits a comment with the locked anchor after the selection collapses', async () => {
    const spy = stubFetch((url, init) => {
      if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ id: 'new1' })
      if (url.includes('/comments')) return jsonResponse({ roots: [] })
      return htmlResponse('<p data-odoc-aid="a3">post anchored words</p>')
    })
    render(<HtmlDocView docId="d1" space="sp" slug="slug-1" version="v4" />)
    const anchored = await screen.findByText('post anchored words')

    selectNodeText(anchored.firstChild ?? anchored)
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a3'))

    const input = screen.getByPlaceholderText('docs.comment.placeholder')
    fireEvent.focus(input)
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    fireEvent.change(input, { target: { value: 'anchored note' } })
    fireEvent.click(screen.getByText('docs.comment.send'))

    await waitFor(() => {
      const post = spy.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST')
      expect(post).toBeTruthy()
    })
    const post = spy.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST') as unknown as [string, RequestInit]
    const body = JSON.parse(String(post[1].body))
    expect(body.anchor).toMatchObject({ kind: 'element', aid: 'a3' })
  })
})

describe('sanitizeDocHtml', () => {
  it('strips <script>, on* handlers and javascript: URLs (XSS baseline)', () => {
    const out = sanitizeDocHtml(
      '<p>hi</p>' +
        '<script>alert(1)</script>' +
        '<img src="x" onerror="alert(2)">' +
        '<a href="javascript:alert(3)">bad link</a>' +
        '<div onclick="alert(4)">clicky</div>',
    )
    expect(out).not.toContain('<script')
    expect(out.toLowerCase()).not.toContain('onerror')
    expect(out.toLowerCase()).not.toContain('onclick')
    expect(out.toLowerCase()).not.toContain('javascript:')
    // The benign wrapper text survives.
    expect(out).toContain('hi')
  })

  it('removes interactive/editable elements and contenteditable (read-only hard rule)', () => {
    const out = sanitizeDocHtml(
      '<p>keep</p>' +
        '<input value="x">' +
        '<button>go</button>' +
        '<textarea>t</textarea>' +
        '<form><select><option>o</option></select></form>' +
        '<div contenteditable="true">editable</div>',
    )
    for (const tag of ['<input', '<button', '<textarea', '<form', '<select', '<option']) {
      expect(out.toLowerCase()).not.toContain(tag)
    }
    expect(out.toLowerCase()).not.toContain('contenteditable')
    expect(out).toContain('keep')
  })

  it('strips inline style entirely (CSS injection surface: url(javascript:)/expression()/exfil url)', () => {
    // DOMPurify keeps inline style verbatim without deep-cleaning CSS values, so the whole
    // attribute is forbidden (method A). The javascript: CSS payload must not survive.
    const out = sanitizeDocHtml('<div style="background:url(javascript:alert(1))">x</div>')
    expect(out.toLowerCase()).not.toContain('javascript:')
    expect(out.toLowerCase()).not.toContain('style=')
    expect(out).toContain('x')
  })

  it('drops even a benign inline style (method A forbids the style attribute wholesale)', () => {
    const out = sanitizeDocHtml('<div style="width:100px">x</div>')
    expect(out.toLowerCase()).not.toContain('style=')
    // The element + text content itself survive; only the style attribute is stripped.
    expect(out).toContain('x')
  })

  it('preserves ordinary display markup (headings/paragraph/table/safe links)', () => {
    const out = sanitizeDocHtml(
      '<h1>Report</h1><p>Body</p><table><tr><td>cell</td></tr></table><a href="https://ok.test">link</a>',
    )
    expect(out).toContain('<h1>')
    expect(out).toContain('<p>')
    expect(out).toContain('<table>')
    expect(out).toContain('href="https://ok.test"')
  })
})
