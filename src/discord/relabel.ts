import { characterLabel } from '../core/profiles.js';
import { log } from '../log.js';
import type { Services } from './registry.js';

type Deps = Pick<Services, 'activities' | 'profiles' | 'publish'>;

// Member id to the activity whose confirmation they started a Battle.net link from. Kept in
// memory only: a link lives 10 minutes, and losing the note just leaves the old name on the post.
const pending = new Map<string, string>();

export function rememberPost(userId: string, activityId: string): void {
  pending.set(userId, activityId);
}

/** Shows the member's main character on their signup of that activity, keeping their place. */
export async function relabel(s: Deps, userId: string, activityId: string): Promise<void> {
  try {
    const view = await s.activities.get(activityId);
    const signup = view?.signups.find((x) => x.userId === userId);
    if (!view || !signup) return;
    if (view.activity.state !== 'open' && view.activity.state !== 'full') return;
    const { characters } = await s.profiles.list(userId);
    if (!characters[0]) return;
    const label = characterLabel(characters[0]);
    if (signup.role) {
      await s.publish(await s.activities.signUp(activityId, userId, { role: signup.role, label }));
    } else if (signup.status === 'tentative' || signup.status === 'absent') {
      await s.publish(
        await s.activities.signUp(activityId, userId, { status: signup.status, label }),
      );
    }
  } catch (err) {
    log.error('relabel failed', { activityId, err });
  }
}

/**
 * After a Battle.net link or a new main character: updates the post the link was started from,
 * if any. The note is kept, so choosing the main right after linking updates the post again.
 */
export async function relabelPending(s: Deps, userId: string): Promise<void> {
  const activityId = pending.get(userId);
  if (activityId) await relabel(s, userId, activityId);
}
