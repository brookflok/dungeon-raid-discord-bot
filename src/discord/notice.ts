import {
  ButtonStyle,
  ComponentType,
  type APIEmbed,
  type ActionRowData,
  type InteractionButtonComponentData,
  type LinkButtonComponentData,
} from 'discord.js';

export const COLOR = {
  ok: 0x22c55e,
  info: 0x3b82f6,
  error: 0xef4444,
  closed: 0x6b7280,
} as const;

/** A small box for a reply; `content` is cleared so it can replace an earlier text reply. */
export function notice(
  text: string,
  tone: 'ok' | 'info' | 'error' = 'info',
  title?: string,
): { content: string; embeds: APIEmbed[] } {
  const embed: APIEmbed = { description: text, color: COLOR[tone] };
  if (title) embed.title = title;
  return { content: '', embeds: [embed] };
}

type Button = InteractionButtonComponentData | LinkButtonComponentData;

export const button = (
  customId: string,
  label: string,
  style: InteractionButtonComponentData['style'] = ButtonStyle.Secondary,
  emoji?: string,
): InteractionButtonComponentData => ({
  type: ComponentType.Button,
  customId,
  label,
  style,
  ...(emoji ? { emoji } : {}),
});

export const linkButton = (url: string, label: string): LinkButtonComponentData => ({
  type: ComponentType.Button,
  style: ButtonStyle.Link,
  label,
  url,
});

export const row = (...components: Button[]): ActionRowData<Button> => ({
  type: ComponentType.ActionRow,
  components,
});
