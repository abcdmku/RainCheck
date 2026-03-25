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

test('severe target flow reloads a conclusion and product cards', async ({
  page,
}) => {
  await page.goto('/chat/thread-research')
  await sendPrompt(
    page,
    'Where is the best tornado target near Austin tonight?',
  )

  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(page.getByText('Weather conclusion')).toBeVisible()
  await expect(
    page.getByText('A narrow boundary near Austin is the best severe-weather focus.'),
  ).toBeVisible()
  await expect(page.getByText('SPC severe context')).toBeVisible()
  await expect(page.getByText('Radar and nowcast')).toBeVisible()
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
    expect(dialog.message()).toContain('Austin severe setup')
    await dialog.accept()
  })

  await page
    .getByRole('button', { name: 'Delete conversation Austin severe setup' })
    .click()

  await deleteResponse
  await page.waitForURL(/\/$/)
  await expect(page.locator('.conversation-list')).not.toContainText(
    'Austin severe setup',
  )
  await expect(page.locator('.empty-thread .sidebar-brand')).toBeVisible()
})
