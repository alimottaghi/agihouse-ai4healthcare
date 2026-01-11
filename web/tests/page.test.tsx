import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dashboard from '../app/page'

// -------------------- helpers --------------------

function makeRow(overrides: Record<string, any> = {}) {
  return {
    type: 'HKQuantityTypeIdentifierStepCount',
    startDate: '2024-01-20 08:00:00 -0700',
    endDate: '2024-01-20 08:05:00 -0700',
    value: '10',
    ...overrides,
  }
}

function makeRows(n: number, base?: Record<string, any>) {
  return Array.from({ length: n }, (_, i) => makeRow({ value: i + 1, ...base }))
}

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> }
) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: init?.headers,
  })
}

function textResponse(text: string, init?: { status?: number; headers?: Record<string, string> }) {
  return new Response(text, { status: init?.status ?? 200, headers: init?.headers })
}

function stubFetchSequence(...responses: Response[]) {
  const mock = vi.fn()
  responses.forEach((r) => mock.mockResolvedValueOnce(r))
  vi.stubGlobal('fetch', mock)
  return mock
}

function parseFetchUrl(fetchMock: ReturnType<typeof vi.fn>, callIndex: number) {
  const arg = fetchMock.mock.calls[callIndex]?.[0]
  const raw = typeof arg === 'string' ? arg : String(arg)
  return new URL(raw, 'http://localhost')
}

function getControls() {
  const file = screen.getByLabelText(/file path/i) as HTMLInputElement
  const types = screen.getByLabelText(/record types/i) as HTMLInputElement
  const start = screen.getByLabelText(/start date/i) as HTMLInputElement
  const end = screen.getByLabelText(/end date/i) as HTMLInputElement
  const loadBtn = screen.getByRole('button', { name: /load data/i })
  const resetBtn = screen.getByRole('button', { name: /reset/i })
  return { file, types, start, end, loadBtn, resetBtn }
}

// -------------------- lifecycle --------------------

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.stubGlobal('fetch', vi.fn())
  process.env.NEXT_PUBLIC_APPLE_XML_PATH = ''
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// -------------------- tests --------------------

describe('Dashboard page', () => {
  it('renders heading and initial "No data loaded" state', () => {
    render(<Dashboard />)
    expect(screen.getByRole('heading', { name: /apple health explorer/i })).toBeInTheDocument()
    expect(screen.getByText(/no data loaded/i)).toBeInTheDocument()
    expect(screen.getByText(/no records loaded/i)).toBeInTheDocument()
  })

  it('pre-fills file path from NEXT_PUBLIC_APPLE_XML_PATH', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_XML_PATH', '/default/path/export.xml')
    render(<Dashboard />)
    const { file } = getControls()
    expect(file).toHaveValue('/default/path/export.xml')
  })

  it('shows a client-side error if file path is missing on submit', async () => {
    render(<Dashboard />)
    const { loadBtn } = getControls()
    await userEvent.click(loadBtn)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(await screen.findByText(/enter file_path or set next_public_apple_xml_path/i)).toBeInTheDocument()
  })

  it('updates inputs as user types', async () => {
    render(<Dashboard />)
    const { file, types, start, end } = getControls()
    await userEvent.type(file, '/tmp/export.xml')
    await userEvent.type(types, 'Steps, HR')
    await userEvent.type(start, '2024-01-01')
    await userEvent.type(end, '2024-01-31')
    expect(file).toHaveValue('/tmp/export.xml')
    expect(types).toHaveValue('Steps, HR')
    expect(start).toHaveValue('2024-01-01')
    expect(end).toHaveValue('2024-01-31')
  })

  it('calls /api/records with correct query params on submit', async () => {
    const fetchMock = stubFetchSequence(jsonResponse([]))
    render(<Dashboard />)
    const { file, types, start, end, loadBtn } = getControls()
    await userEvent.type(file, 'data.xml')
    await userEvent.type(types, 'TypeA, TypeB')
    await userEvent.type(start, '2024-01-01')
    await userEvent.type(end, '2024-01-31')
    await userEvent.click(loadBtn)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const u = parseFetchUrl(fetchMock, 0)
    expect(u.pathname).toBe('/api/records')
    expect(u.searchParams.get('file_path')).toBe('data.xml')
    expect(u.searchParams.getAll('types').sort()).toEqual(['TypeA', 'TypeB'].sort())
    expect(u.searchParams.get('start')).toBe('2024-01-01')
    expect(u.searchParams.get('end')).toBe('2024-01-31')
  })

  it('disables "Load Data" while request is in flight, then re-enables', async () => {
    let resolve!: (r: Response) => void
    const pending = new Promise<Response>((r) => (resolve = r))
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(pending))

    render(<Dashboard />)
    const { file, loadBtn } = getControls()
    await userEvent.type(file, 'data.xml')

    await userEvent.click(loadBtn)

    const loadingBtn = await screen.findByRole('button', { name: /loading/i })
    expect(loadingBtn).toBeDisabled()

    resolve(jsonResponse([]))

    const idleBtn = await screen.findByRole('button', { name: /load data/i })
    expect(idleBtn).not.toBeDisabled()
  })

  it('renders rows and shows record count', async () => {
    const rows = [
      makeRow({ type: 'StepCount', value: 100 }),
      makeRow({ type: 'HeartRate', value: 75 }),
    ]
    stubFetchSequence(jsonResponse(rows))

    render(<Dashboard />)
    const { file, loadBtn } = getControls()
    await userEvent.type(file, 'data.xml')
    await userEvent.click(loadBtn)

    expect(await screen.findByText('100')).toBeInTheDocument()
    expect(screen.getByText('75')).toBeInTheDocument()
    expect(screen.getByText((content, element) => {
      return element?.textContent === '2 records loaded'
    })).toBeInTheDocument()
  })

  it('shows JSON-detail error (404 with {detail}) and clears rows', async () => {
    const fetchMock = stubFetchSequence(jsonResponse(makeRows(2)))
    render(<Dashboard />)
    const { file, loadBtn } = getControls()

    await userEvent.type(file, 'data.xml')
    await userEvent.click(loadBtn)
    expect(await screen.findAllByText(/^view$/i)).toHaveLength(2)

    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Missing file' }, { status: 404 }))

    await userEvent.click(loadBtn)

    expect(screen.getByText(/missing file/i)).toBeInTheDocument()
    expect(screen.getByText(/no records loaded/i)).toBeInTheDocument()
  })

  it('shows generic error for plain-text 500', async () => {
    stubFetchSequence(textResponse('boom', { status: 500 }))

    render(<Dashboard />)
    const { file, loadBtn } = getControls()
    await userEvent.type(file, 'data.xml')
    await userEvent.click(loadBtn)

    expect(await screen.findByText(/request failed \(500\)/i)).toBeInTheDocument()
  })

  it('type column fallback: type → workoutActivityType → _tag → —', async () => {
    const rows = [
      makeRow({ type: 'HKQuantityTypeIdentifierStepCount' }),
      makeRow({ type: undefined, workoutActivityType: 'HKWorkoutActivityTypeRunning' }),
      makeRow({ type: undefined, workoutActivityType: undefined, _tag: 'Workout' }),
    ]
    stubFetchSequence(jsonResponse(rows))

    render(<Dashboard />)
    const { file, loadBtn } = getControls()
    await userEvent.type(file, 'data.xml')
    await userEvent.click(loadBtn)

    const bodyRows = screen.getAllByRole('row').slice(1) // skip header
    expect(within(bodyRows[0]!).getAllByRole('cell')[0]!).toHaveTextContent('HKQuantityTypeIdentifierStepCount')
    expect(within(bodyRows[1]!).getAllByRole('cell')[0]!).toHaveTextContent('HKWorkoutActivityTypeRunning')
    expect(within(bodyRows[2]!).getAllByRole('cell')[0]!).toHaveTextContent('Workout')

    await userEvent.click(screen.getAllByText(/^view$/i)[0]!)
    expect(await screen.findByText(/"type": "HKQuantityTypeIdentifierStepCount"/)).toBeInTheDocument()
  })

  it('Reset clears state and restores env default path', async () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_XML_PATH', '/env/export.xml')
    stubFetchSequence(jsonResponse(makeRows(2)))

    render(<Dashboard />)
    const { file, types, start, end, loadBtn, resetBtn } = getControls()

    await userEvent.clear(file)
    await userEvent.type(file, '/tmp/other.xml')
    await userEvent.type(types, 'A,B')
    await userEvent.type(start, '2024-01-20 08:00:00 -0700')
    await userEvent.type(end, '2024-01-20 09:00:00 -0700')
    await userEvent.click(loadBtn)
    expect(await screen.findAllByText(/^view$/i)).toHaveLength(2)

    await userEvent.click(resetBtn)

    await waitFor(() => {
      expect((screen.getByLabelText(/file path/i) as HTMLInputElement).value).toBe('/env/export.xml')
    })
    expect((screen.getByLabelText(/record types/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/start date/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/end date/i) as HTMLInputElement).value).toBe('')

    expect(screen.getByText(/no records loaded/i)).toBeInTheDocument()
    expect(screen.getByText(/no data loaded/i)).toBeInTheDocument()
    expect(screen.queryByText(/missing file/i)).not.toBeInTheDocument()
  })
})