// Election Simulator Logic
document.addEventListener('DOMContentLoaded', () => {
    // Initialize map and global variables
    const map = L.map('map').setView([37.8, -96], 4);
    let allDistricts = [];
    const regions = {
        pacifica: ['WA', 'OR', 'CA', 'AK', 'HI', 'ID', 'NV', 'UT', 'AZ'],
        olympia: ['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA', 'DE', 'MD', 'VA'],
        jackson: ['NC', 'SC', 'FL', 'GA', 'TN', 'MS', 'AL', 'LA', 'AR'],
        frontier: ['TX', 'CO', 'NM', 'OK', 'KS', 'NE', 'SD', 'ND', 'MT', 'WY'],
        lincoln: ['OH', 'KY', 'IN', 'WV', 'IL', 'IA', 'MO', 'MN', 'WI', 'MI']
    };

    let currentSimulation = {
        nationalSwing: 0,
        regionalSwings: {
            pacifica: 0,
            olympia: 0,
            jackson: 0,
            frontier: 0,
            lincoln: 0
        },
        regionalSenateResults: {
            pacifica: 0,
            olympia: 0,
            jackson: 0,
            frontier: 0,
            lincoln: 0
        },
        stateModifiers: {},
        stateSwings: {},    // Add this line
        leadershipSwing: 0
    };
    const scenarioButtons = document.querySelectorAll('.scenario-btn');

    function formatPercent(value) {
        const numeric = Number(value) || 0;
        return `${numeric > 0 ? '+' : ''}${numeric}%`;
    }

    function setScenarioButtonState(activeScenario) {
        scenarioButtons.forEach(button => {
            const matches = button.getAttribute('onclick')?.includes(`'${activeScenario}'`);
            button.classList.toggle('active', Boolean(matches));
        });
    }

    function syncControlValue(inputId, value, outputId = null) {
        const input = document.getElementById(inputId);
        if (!input) {
            return;
        }

        input.value = value;
        const output = outputId ? document.getElementById(outputId) : input.nextElementSibling;
        if (output) {
            output.textContent = formatPercent(value);
        }
    }

    function syncControlsFromSimulation(activeScenario = 'custom') {
        syncControlValue('nationalSwing', currentSimulation.nationalSwing);
        Object.keys(regions).forEach(region => {
            syncControlValue(`${region}Swing`, currentSimulation.regionalSwings[region]);
            syncControlValue(`${region}Senate`, currentSimulation.regionalSenateResults[region]);
        });

        const stateSelect = document.getElementById('stateSelect');
        const selectedState = stateSelect.value || stateSelect.options[0]?.value;
        if (selectedState) {
            stateSelect.value = selectedState;
            syncControlValue('senateResult', currentSimulation.stateSwings[selectedState] || 0, 'stateSwingValue');
        }

        syncControlValue('leadershipResult', currentSimulation.leadershipSwing);
        setScenarioButtonState(activeScenario);
    }

    // Add the base tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: 'Map data &copy; OpenStreetMap contributors'
    }).addTo(map);

    // Color functions for district visualization
    function getPartyColor(percentage, party) {
        if (party === 'D') {
            if (percentage >= 58) return '#0000FF'; // Safe D
            if (percentage >= 54) return '#6666FF'; // Likely D
            if (percentage >= 50) return '#9999FF'; // Lean D
            return '#CCCCFF'; // Tilt D
        } else {
            if (percentage >= 58) return '#FF0000'; // Safe R
            if (percentage >= 54) return '#FF6666'; // Likely R
            if (percentage >= 50) return '#FF9999'; // Lean R
            return '#FFCCCC'; // Tilt R
        }
    }

    // Load and process district data
    fetch('vchousemap2KeyComposites.geojson')
        .then(response => response.json())
        .then(data => {
            const geojsonLayer = L.geoJSON(data, {
                style: feature => styleDistrict(feature),
                onEachFeature: (feature, layer) => {
                    allDistricts.push({ feature, layer });
                    bindDistrictPopup(feature, layer);
                }
            }).addTo(map);
            
            // Initial simulation results
            updateSimulationResults();
        })
        .catch(err => console.error('Error loading district data:', err));

    // Style district based on election data
    function styleDistrict(feature) {
        const props = feature.properties;
        const baseD = (parseFloat(props.DemPct) || 0) * 100;
        const baseR = (parseFloat(props.RepPct) || 0) * 100;

        // Calculate adjusted percentages
        let adjD = baseD;
        let adjR = baseR;
        
        // Apply national swing
        adjD += currentSimulation.nationalSwing;
        adjR -= currentSimulation.nationalSwing;
        
        // Apply regional swing
        const state = props.State;
        const region = Object.keys(regions).find(r => regions[r].includes(state));
        if (region && currentSimulation.regionalSwings[region]) {
            adjD += currentSimulation.regionalSwings[region];
            adjR -= currentSimulation.regionalSwings[region];
        }
        
        // Apply regional senate result (one-third of the margin)
        if (region && currentSimulation.regionalSenateResults[region]) {
            const senateImpact = currentSimulation.regionalSenateResults[region] / 3;
            adjD += senateImpact;
            adjR -= senateImpact;
        }
        
        // Apply state modifiers
        if (currentSimulation.stateModifiers[state]) {
            adjD += currentSimulation.stateModifiers[state];
            adjR -= currentSimulation.stateModifiers[state];
        }
        
        // Apply state swing
        if (currentSimulation.stateSwings[state]) {
            adjD += currentSimulation.stateSwings[state];
            adjR -= currentSimulation.stateSwings[state];
        }
        
        // Apply leadership swing
        adjD += currentSimulation.leadershipSwing;
        adjR -= currentSimulation.leadershipSwing;
        
        // Determine winning party and margin
        const margin = Math.max(adjD, adjR);
        const winner = adjD > adjR ? 'D' : 'R';
        
        return {
            fillColor: getPartyColor(margin, winner),
            weight: 1,
            opacity: 1,
            color: '#666',
            fillOpacity: 0.7
        };
    }

    // Default style for districts with no data
    function defaultStyle() {
        return {
            fillColor: '#CCCCCC',
            weight: 1,
            opacity: 1,
            color: '#666',
            fillOpacity: 0.7
        };
    }

    // Bind popup to district
    function bindDistrictPopup(feature, layer) {
        const props = feature.properties;
        if (!props) {
            layer.bindPopup('No data available');
            return;
        }

        const baseD = (parseFloat(props.DemPct) || 0) * 100;
        const baseR = (parseFloat(props.RepPct) || 0) * 100;

        // Calculate adjusted percentages
        let adjD = baseD;
        let adjR = baseR;
        
        // Apply all swings
        adjD += currentSimulation.nationalSwing;
        adjR -= currentSimulation.nationalSwing;
        
        const state = props.State;
        const region = Object.keys(regions).find(r => regions[r].includes(state));
        
        // Apply regional swing
        if (region && currentSimulation.regionalSwings[region]) {
            adjD += currentSimulation.regionalSwings[region];
            adjR -= currentSimulation.regionalSwings[region];
        }
        
        // Apply regional senate result (one-third of the margin)
        if (region && currentSimulation.regionalSenateResults[region]) {
            const senateImpact = currentSimulation.regionalSenateResults[region] / 3;
            adjD += senateImpact;
            adjR -= senateImpact;
        }
        
        // Apply state modifiers
        if (currentSimulation.stateModifiers[state]) {
            adjD += currentSimulation.stateModifiers[state];
            adjR -= currentSimulation.stateModifiers[state];
        }
        
        // Apply state swing
        if (currentSimulation.stateSwings[state]) {
            adjD += currentSimulation.stateSwings[state];
            adjR -= currentSimulation.stateSwings[state];
        }
        
        // Apply leadership swing
        adjD += currentSimulation.leadershipSwing;
        adjR -= currentSimulation.leadershipSwing;

        // Ensure percentages are within bounds
        adjD = Math.max(0, Math.min(100, adjD));
        adjR = Math.max(0, Math.min(100, adjR));

        const swing = adjD - baseD;

        const content = `
            <div class="district-popup">
                <h3>${props.State}-${props.District}</h3>
                <p><strong>Base Result:</strong></p>
                <div class="vote-share">
                    <div>Democratic: ${baseD.toFixed(1)}%</div>
                    <div>Republican: ${baseR.toFixed(1)}%</div>
                </div>
                <p><strong>Projected Result:</strong></p>
                <div class="vote-share">
                    <div style="color: ${adjD > adjR ? 'blue' : '#666'}">Democratic: ${adjD.toFixed(1)}%</div>
                    <div style="color: ${adjR > adjD ? 'red' : '#666'}">Republican: ${adjR.toFixed(1)}%</div>
                </div>
                <p><strong>Swing: ${swing > 0 ? '+' : ''}${swing.toFixed(1)}%</strong></p>
            </div>
        `;
        layer.bindPopup(content);
    }

    // Simulation Functions
    function applyNationalSwing(baseVotes, swing) {
        return baseVotes * (1 + (swing / 100));
    }

    function applyRegionalSwing(votes, swing, isTarget) {
        if (!isTarget) return votes;
        return votes * (1 + (swing / 100));
    }

    function applyTurnoutModel(votes, model, demographics) {
        switch (model) {
            case 'high':
                return votes * 1.1;
            case 'low':
                return votes * 0.9;
            default:
                return votes;
        }
    }

    function applyDemographicShift(votes, shift, demographics) {
        const shifts = {
            suburban: 1.05,
            rural: 0.95,
            youth: 1.15
        };
        return votes * (shifts[shift] || 1);
    }

    // Update simulation based on current parameters
    function updateSimulation() {
        allDistricts.forEach(({ feature, layer }) => {
            const props = feature.properties;
            let demPct = (parseFloat(props.DemPct) || 0) * 100;
            let repPct = (parseFloat(props.RepPct) || 0) * 100;
            
            // Apply national swing
            demPct += currentSimulation.nationalSwing;
            repPct -= currentSimulation.nationalSwing;

            // Apply regional swing
            const state = props.State;
            const region = Object.keys(regions).find(r => regions[r].includes(state));
            if (region) {
                demPct += currentSimulation.regionalSwings[region];
                repPct -= currentSimulation.regionalSwings[region];
            }

            // Apply regional senate result
            if (region) {
                demPct += currentSimulation.regionalSenateResults[region];
                repPct -= currentSimulation.regionalSenateResults[region];
            }

            // Apply state-specific swing
            if (currentSimulation.stateSwings[state]) {
                demPct += currentSimulation.stateSwings[state];
                repPct -= currentSimulation.stateSwings[state];
            }

            // Apply leadership swing
            demPct += currentSimulation.leadershipSwing;
            repPct -= currentSimulation.leadershipSwing;

            // Update feature properties
            feature.properties.simDemPct = Math.max(0, Math.min(100, demPct));
            feature.properties.simRepPct = Math.max(0, Math.min(100, repPct));

            // Update district style
            layer.setStyle(styleDistrict(feature));
            bindDistrictPopup(feature, layer);
        });

        updateSimulationResults();
    }

    // Update simulation results display
    function updateSimulationResults() {
        let demSeats = 0;
        let repSeats = 0;

        allDistricts.forEach(({ feature }) => {
            const props = feature.properties;
            if (!props) return;

            let adjD = (parseFloat(props.DemPct) || 0) * 100;
            let adjR = (parseFloat(props.RepPct) || 0) * 100;
            
            // Apply all modifiers
            adjD += currentSimulation.nationalSwing;
            adjR -= currentSimulation.nationalSwing;
            
            const state = props.State;
            const region = Object.keys(regions).find(r => regions[r].includes(state));
            
            if (region && currentSimulation.regionalSwings[region]) {
                adjD += currentSimulation.regionalSwings[region];
                adjR -= currentSimulation.regionalSwings[region];
            }
            
            if (region && currentSimulation.regionalSenateResults[region]) {
                const senateImpact = currentSimulation.regionalSenateResults[region] / 3;
                adjD += senateImpact;
                adjR -= senateImpact;
            }
            
            if (currentSimulation.stateModifiers[state]) {
                adjD += currentSimulation.stateModifiers[state];
                adjR -= currentSimulation.stateModifiers[state];
            }
            
            if (currentSimulation.stateSwings[state]) {
                adjD += currentSimulation.stateSwings[state];
                adjR -= currentSimulation.stateSwings[state];
            }
            
            adjD += currentSimulation.leadershipSwing;
            adjR -= currentSimulation.leadershipSwing;

            // Count seats based on adjusted percentages
            if (adjD > adjR) {
                demSeats++;
            } else {
                repSeats++;
            }
        });

        // Update the display
        document.getElementById('demSeats').textContent = demSeats;
        document.getElementById('repSeats').textContent = repSeats;
        const summary = document.getElementById('seatSummary');
        if (summary) {
            const seatDelta = demSeats - repSeats;
            if (seatDelta > 0) {
                summary.textContent = `Democrats lead by ${seatDelta} seat${seatDelta === 1 ? '' : 's'}.`;
            } else if (seatDelta < 0) {
                const gap = Math.abs(seatDelta);
                summary.textContent = `Republicans lead by ${gap} seat${gap === 1 ? '' : 's'}.`;
            } else {
                summary.textContent = 'Even environment.';
            }
        }
    }

    // Event Listeners
    document.getElementById('nationalSwing').addEventListener('input', e => {
        const value = parseFloat(e.target.value);
        currentSimulation.nationalSwing = value;
        e.target.nextElementSibling.textContent = formatPercent(value);
        setScenarioButtonState('custom');
        updateSimulation();
    });

    // Scenario presets
    window.setScenario = function(scenario) {
        switch (scenario) {
            case 'base':
                currentSimulation = {
                    nationalSwing: 0,
                    regionalSwings: {
                        pacifica: 0,
                        olympia: 0,
                        jackson: 0,
                        frontier: 0,
                        lincoln: 0
                    },
                    regionalSenateResults: {
                        pacifica: 0,
                        olympia: 0,
                        jackson: 0,
                        frontier: 0,
                        lincoln: 0
                    },
                    stateModifiers: {},
                    stateSwings: {},    // Add this line
                    leadershipSwing: 0
                };
                break;
            case 'wave':
                currentSimulation = {
                    nationalSwing: 5,
                    regionalSwings: {
                        pacifica: 2,
                        olympia: 3,
                        jackson: 1,
                        frontier: 2,
                        lincoln: 3
                    },
                    regionalSenateResults: {
                        pacifica: 0,
                        olympia: 0,
                        jackson: 0,
                        frontier: 0,
                        lincoln: 0
                    },
                    stateModifiers: {},
                    stateSwings: {},    // Add this line
                    leadershipSwing: 1
                };
                break;
            case 'custom':
                setScenarioButtonState('custom');
                syncControlsFromSimulation('custom');
                updateSimulation();
                return;
        }

        syncControlsFromSimulation(scenario);
        updateSimulation();
    };

    // Populate state select
    const stateSelect = document.getElementById('stateSelect');
    const states = [...new Set([].concat(...Object.values(regions)))].sort();
    states.forEach(state => {
        const option = document.createElement('option');
        option.value = state;
        option.textContent = state;
        stateSelect.appendChild(option);
    });

    // Add event listeners for regional swings
    Object.keys(regions).forEach(region => {
        const slider = document.getElementById(`${region}Swing`);
        slider.addEventListener('input', e => {
            const value = parseFloat(e.target.value);
            currentSimulation.regionalSwings[region] = value;
            e.target.nextElementSibling.textContent = formatPercent(value);
            setScenarioButtonState('custom');
            updateSimulation();
        });
    });

    // Add event listener for state results
    document.getElementById('stateSelect').addEventListener('change', e => {
        const state = e.target.value;
        const result = currentSimulation.stateSwings[state] || 0;
        syncControlValue('senateResult', result, 'stateSwingValue');
        currentSimulation.stateSwings[state] = result;
        setScenarioButtonState('custom');
        updateSimulation();
    });

    document.getElementById('senateResult').addEventListener('input', e => {
        const value = parseFloat(e.target.value);
        const state = document.getElementById('stateSelect').value;
        currentSimulation.stateSwings[state] = value;
        document.getElementById('stateSwingValue').textContent = formatPercent(value);
        setScenarioButtonState('custom');
        updateSimulation();
    });

    // Add event listener for leadership result
    document.getElementById('leadershipResult').addEventListener('input', e => {
        const value = parseFloat(e.target.value);
        currentSimulation.leadershipSwing = value;
        const valueSpan = e.target.nextElementSibling;
        if (valueSpan) {
            valueSpan.textContent = formatPercent(value);
        }
        setScenarioButtonState('custom');
        updateSimulation();
    });

    // Add function to create state modifier
    function addStateModifier() {
        const stateModifiersList = document.getElementById('stateModifiersList');
        const div = document.createElement('div');
        div.className = 'state-modifier';
        
        const select = document.createElement('select');
        const states = [...new Set([].concat(...Object.values(regions)))].sort();
        states.forEach(state => {
            const option = document.createElement('option');
            option.value = state;
            option.textContent = state;
            select.appendChild(option);
        });

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '-30';
        input.max = '30';
        input.value = '0';
        input.step = '0.1';

        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'X';
        removeBtn.onclick = () => {
            div.remove();
            delete currentSimulation.stateModifiers[select.value];
            setScenarioButtonState('custom');
            updateSimulation();
        };

        // Add event listeners
        select.onchange = () => {
            currentSimulation.stateModifiers[select.value] = parseFloat(input.value);
            setScenarioButtonState('custom');
            updateSimulation();
        };

        input.oninput = () => {
            currentSimulation.stateModifiers[select.value] = parseFloat(input.value);
            setScenarioButtonState('custom');
            updateSimulation();
        };

        div.appendChild(select);
        div.appendChild(input);
        div.appendChild(removeBtn);
        stateModifiersList.appendChild(div);
    }
    window.addStateModifier = addStateModifier;

    // Add event listeners for regional senate results
    Object.keys(regions).forEach(region => {
        const input = document.getElementById(`${region}Senate`);
        input.addEventListener('input', e => {
            const value = parseFloat(e.target.value);
            currentSimulation.regionalSenateResults[region] = value;
            e.target.nextElementSibling.textContent = formatPercent(value);
            setScenarioButtonState('custom');
            updateSimulation();
        });
    });

    syncControlsFromSimulation('base');
});
