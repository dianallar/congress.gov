import json

state_names = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", 
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "PR": "Puerto Rico", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming"
}

def number_to_ordinal(n):
    if 10 <= n % 100 <= 20:
        suffix = 'th'
    else:
        suffix = {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return f"{n}{suffix}"

with open('delawaretesting.geojson', 'r') as f:
    data = json.load(f)

with open('state_district_count_reference.json', 'r') as f:
    state_districts = json.load(f)

current_state = None
current_district_counter = 0

for feature in data['features']:
    if current_district_counter == 0:
        current_state = next(iter(state_districts))
        district_count = state_districts[current_state]
    
    feature['properties']['State'] = current_state
    
    district_number = current_district_counter + 1
    feature['properties']['District'] = district_number
    
    key_composite = f"{current_state}-{district_number}"
    feature['properties']['KeyComposite'] = key_composite
    
    long_name = f"{state_names[current_state]}'s {number_to_ordinal(district_number)} Congressional District"
    feature['properties']['LongName'] = long_name
    
    current_district_counter += 1
    
    if current_district_counter == district_count:
        del state_districts[current_state]  # Move to the next state
        current_district_counter = 0

with open('delawaretesting.geojson', 'w') as f:
    json.dump(data, f)
