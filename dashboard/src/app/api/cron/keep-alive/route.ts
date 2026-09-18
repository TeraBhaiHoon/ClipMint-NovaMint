import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 10;

/**
 * GET /api/cron/keep-alive
 *
 * Pings Supabase with a simple query to prevent the free-tier project
 * from pausing due to inactivity (pauses after 7 days with no activity).
 *
 * Scheduled to run every 2 days via Vercel Cron.
 */
export async function GET(request: Request) {
  // Fail closed: without a configured secret this endpoint must not run at all.
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[Keep-Alive] CRON_SECRET is not set — refusing to run.');
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured' },
      { status: 500 }
    );
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Service role only — the anon key cannot prove the database is reachable
    // for privileged work and used to make this endpoint report false success.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('[Keep-Alive] SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is not set');
      return NextResponse.json(
        { error: 'Supabase not configured' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Simple lightweight query — just checks connection is alive
    const { count, error } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('[Keep-Alive] Supabase ping failed:', error.message);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    console.log(`[Keep-Alive] ✅ ClipMint Supabase is alive — ${count} profiles`);
    return NextResponse.json({
      ok: true,
      project: 'ClipMint',
      timestamp: new Date().toISOString(),
      profiles: count,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Keep-Alive] Error:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
