from bs4 import BeautifulSoup
import json
import os

# 1. Load existing slots
existing_slots = []
if os.path.exists('slots.json'):
    with open('slots.json', 'r', encoding='utf-8') as f:
        existing_slots = json.load(f)
    print(f"📖 Loaded {len(existing_slots)} existing slots")
else:
    print("📁 No existing slots.json, starting fresh")

# 2. Scrape new slots from the saved HTML file
with open('only-on-stake.html', 'r', encoding='utf-8') as f:
    soup = BeautifulSoup(f.read(), 'html.parser')

new_slots = []
for game in soup.find_all('div', class_='wrap svelte-1byrcnp'):
    img = game.find('img')
    name_span = game.find('span', class_='ds-body-md-strong w-full text-white mb-2')
    provider_div = game.find('div', class_='game-info-wrap game-group svelte-1o5l7az')
    if img and name_span and provider_div:
        provider = provider_div.get_text(strip=True)
        # Clean up provider name (remove any "game_kurator_group." prefix if present)
        if provider.startswith('game_kurator_group.'):
            provider = provider.replace('game_kurator_group.', '')
        new_slots.append({
            'name': name_span.get_text(strip=True),
            'provider': provider,
            'image_url': img.get('src')
        })

print(f"🔍 Found {len(new_slots)} new slots in HTML")

# 3. Merge (keep unique by name, but update provider if changed)
merged = {slot['name']: slot for slot in existing_slots}
for slot in new_slots:
    name = slot['name']
    if name not in merged:
        merged[name] = slot
    else:
        # Optionally update provider if changed (keep the new one)
        if merged[name].get('provider') != slot.get('provider'):
            merged[name]['provider'] = slot.get('provider')
        # Also update image_url if changed (optional)
        if merged[name].get('image_url') != slot.get('image_url'):
            merged[name]['image_url'] = slot.get('image_url')

merged_list = list(merged.values())

# 4. Save back to slots.json
with open('slots.json', 'w', encoding='utf-8') as f:
    json.dump(merged_list, f, indent=2, ensure_ascii=False)

print(f"✅ Saved {len(merged_list)} total unique slots (added {len(merged_list) - len(existing_slots)} new)")