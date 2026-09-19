-- ClipMint — user-supplied BGM uploads (2026-09-19)
alter table public.jobs add column if not exists custom_bgm_url text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bgm-uploads', 'bgm-uploads', true, 26214400, array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg'])
on conflict (id) do nothing;
create policy "bgm upload own folder" on storage.objects for insert to authenticated
with check (bucket_id = 'bgm-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "bgm public read" on storage.objects for select using (bucket_id = 'bgm-uploads');
alter table public.jobs add column if not exists bgm_mood text;
