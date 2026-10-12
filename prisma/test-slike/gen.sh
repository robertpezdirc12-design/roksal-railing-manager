#!/bin/bash
set -e
gen() {
  local file="$1"; local size="$2"; local prompt="$3"
  if [ -s "$file" ]; then echo "SKIP $file (obstaja)"; return; fi
  echo "GEN $file …"
  z-ai image -p "$prompt" -o "./$file" -s "$size" >/dev/null 2>&1 && echo "  OK $file ($(stat -c%s "$file" 2>/dev/null || stat -f%z "$file") B)" || echo "  NAPAKA $file"
}
gen "balkon-steklo.png" "1344x768" "Modern apartment balcony with elegant glass railing panels secured by slim silver aluminum posts, bright daylight, residential building exterior, professional architectural photography, realistic photo, high quality, detailed"
gen "terasna-ograja.png" "1344x768" "Modern house terrace with anthracite grey aluminum fence, vertical slats, clean minimalist design, wooden deck, garden in background, sunny day, professional architectural photography, realistic photo, high quality"
gen "stopniska.png" "768x1344" "Modern interior staircase with sleek aluminum and glass railing, white wall, wooden stairs, natural light from window, professional architectural photography, realistic photo, high quality, detailed"
gen "montaza-pred.png" "1344x768" "Empty concrete terrace of residential building under construction, no railing yet, tools and material boxes on floor, cloudy sky, realistic construction site photo, documentary style, high quality"
gen "montaza-med.png" "1344x768" "Two workers in work clothes and gloves installing anthracite aluminum railing posts on a concrete terrace with drill and level tool, half-finished fence visible, realistic construction site photo, documentary style, daylight, high quality"
gen "montaza-po.png" "1344x768" "Finished anthracite aluminum railing fence on a concrete residential terrace, clean installation, view from the terrace corner, evening golden light, realistic photo, documentary architecture photography, high quality"
gen "meritev.png" "1344x768" "Worker hands measuring the edge of a terrace with yellow measuring tape and pencil, concrete parapet edge, clipboard with paper nearby, realistic documentary photo, shallow depth of field, daylight, high quality"
gen "napaka-praskana.png" "1344x768" "Close-up of a deep scratch on the powder coated surface of an anthracite aluminum railing post, visible coating damage on metal, inspection context, realistic documentary photo, macro detail, daylight, high quality"
gen "kovana-ograja.png" "1344x768" "Elegant black wrought iron garden fence with decorative forging pattern at a house entrance, stone pillars, green garden, sunny day, realistic architectural photography, high quality, detailed"
echo "KONEC"
