import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NotificationBell from '../NotificationBell'
import {
  NOTIFICATIONS_UPDATED_EVENT,
  OPEN_DASHBOARD_TAB_EVENT,
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../lib/api'

// Mantém as constantes reais dos eventos e simula só as chamadas à API
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchUnreadCount: vi.fn(),
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}))

const unread = {
  id: 1,
  type: 'NEW_BREACH',
  title: 'Seu e-mail apareceu em 1 novo vazamento',
  body: 'ShopBR',
  riskScoreAfter: 60,
  readAt: null,
  createdAt: '2026-10-16T21:43:54.000Z',
}

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchUnreadCount.mockResolvedValue({ count: 1 })
    fetchNotifications.mockResolvedValue({ items: [unread], nextCursor: null })
    markNotificationRead.mockResolvedValue(undefined)
    markAllNotificationsRead.mockResolvedValue(undefined)
  })

  it('shows the unread count on the bell', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 2 })
    render(<NotificationBell />)

    expect(await screen.findByRole('button', { name: 'Notificações, 2 não lidas' })).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('caps the badge at 99+', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 120 })
    render(<NotificationBell />)

    expect(await screen.findByText('99+')).toBeInTheDocument()
  })

  it('marks a notification as read and opens the breaches tab', async () => {
    const openTab = vi.fn()
    window.addEventListener(OPEN_DASHBOARD_TAB_EVENT, openTab)
    const user = userEvent.setup()
    render(<NotificationBell />)

    await user.click(await screen.findByRole('button', { name: 'Notificações, 1 não lida' }))
    await user.click(await screen.findByRole('button', { name: /Seu e-mail apareceu em 1 novo vazamento/ }))

    expect(markNotificationRead).toHaveBeenCalledWith(1)
    expect(openTab).toHaveBeenCalledWith(expect.objectContaining({ detail: 'breaches' }))
    expect(screen.queryByRole('dialog', { name: 'Notificações' })).not.toBeInTheDocument()
    // Depois de ler, o contador é consultado de novo
    expect(fetchUnreadCount.mock.calls.length).toBeGreaterThanOrEqual(2)
    window.removeEventListener(OPEN_DASHBOARD_TAB_EVENT, openTab)
  })

  it('marks everything as read and then disables the action', async () => {
    const user = userEvent.setup()
    render(<NotificationBell />)

    await user.click(await screen.findByRole('button', { name: 'Notificações, 1 não lida' }))
    const readAll = await screen.findByRole('button', { name: 'Marcar todas como lidas' })
    await waitFor(() => expect(readAll).toBeEnabled())
    await user.click(readAll)

    expect(markAllNotificationsRead).toHaveBeenCalledTimes(1)
    expect(readAll).toBeDisabled()
  })

  it('shows the empty state and closes with Escape', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 0 })
    fetchNotifications.mockResolvedValue({ items: [], nextCursor: null })
    const user = userEvent.setup()
    render(<NotificationBell />)

    await user.click(screen.getByRole('button', { name: 'Notificações' }))
    expect(await screen.findByText(/Nenhuma notificação por enquanto/)).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Notificações' })).not.toBeInTheDocument()
  })

  it('tells the dashboard to reload when a new notification arrives', async () => {
    const updated = vi.fn()
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, updated)
    render(<NotificationBell />)
    await screen.findByRole('button', { name: 'Notificações, 1 não lida' })

    fetchUnreadCount.mockResolvedValue({ count: 2 })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await screen.findByRole('button', { name: 'Notificações, 2 não lidas' })
    expect(updated).toHaveBeenCalledTimes(1)
    window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, updated)
  })
})
