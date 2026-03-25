import { expect, type Page, test } from '@playwright/test'

async function sendPrompt(page: Page, prompt: string) {
  const composer = page.getByLabel('Ask RainCheck about the weather')
  const sendButton = page.getByRole('button', { name: 'Send' })
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/chat') &&
      response.request().method() === 'POST',
  )

  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await composer.click()
  await composer.fill(prompt)
  await expect(sendButton).toBeEnabled()
  await sendButton.click()
  await responsePromise
}

test('current weather flow streams an answer and reloads a weather card', async ({
  page,
}) => {
  await page.goto('/chat/thread-weather')
  await sendPrompt(page, 'Weather in Austin?')

  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(page.getByText('Current conditions')).toBeVisible()
  await expect(page.getByText(/72.*F/)).toBeVisible()
})

test('new thread flow creates a conversation from the landing page', async ({
  page,
}) => {
  await page.goto('/')
  await sendPrompt(page, 'Will it rain in Austin today?')

  await page.waitForURL(/\/chat\/thread-\d+$/)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Current conditions')).toBeVisible()
})

test('research flow reloads an artifact card and opens the viewer', async ({
  page,
}) => {
  await page.goto('/chat/thread-research')
  await sendPrompt(
    page,
    'Compare HRRR and GFS and make a research brief for Austin.',
  )

  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(
    page.getByRole('button', { name: 'Open artifact' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Open artifact' }).click()
  await expect(page.getByText('Research report for Austin, TX')).toBeVisible()
  await expect(
    page.locator('iframe[title="Research report for Austin, TX"]'),
  ).toBeVisible()
})

test('conversation history lets you delete a past thread', async ({ page }) => {
  await page.goto('/chat/thread-research')

  const deleteResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/conversations/thread-research') &&
      response.request().method() === 'DELETE',
  )

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    expect(dialog.message()).toContain('Austin research')
    await dialog.accept()
  })

  await page
    .getByRole('button', { name: 'Delete conversation Austin research' })
    .click()

  await deleteResponse
  await page.waitForURL(/\/$/)
  await expect(page.locator('.conversation-list')).not.toContainText(
    'Austin research',
  )
  await expect(page.locator('.empty-thread .sidebar-brand')).toBeVisible()
})
