import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

const MAPBOX_TOKEN =
  "pk.eyJ1IjoidmljaGVuMSIsImEiOiJjbWh6ZnYyNnMwbjc2MnFvZjVhaWJuYjRwIn0.7-MNkrqe-P0bNG-qk3EZ9A";

mapboxgl.accessToken = MAPBOX_TOKEN;

// ------------------------------------
// Helper function to format time
// ------------------------------------
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

// ------------------------------------
// Helper function to get minutes since midnight from Date object
// ------------------------------------
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// ------------------------------------
// Helper function to filter trips by minute (efficient version)
// ------------------------------------
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // No filtering, return all trips
  }

  // Normalize both min and max minutes to the valid range [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  // Handle time filtering across midnight
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// ------------------------------------
// Helper function to compute station traffic
// ------------------------------------
function computeStationTraffic(stations, timeFilter = -1) {
  // Retrieve filtered trips efficiently
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter), // Efficient retrieval
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter), // Efficient retrieval
    (v) => v.length,
    (d) => d.end_station_id
  );

  // Update station data with filtered counts
  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}

// Global variable for time filter
let timeFilter = -1;

// Pre-grouped trip lists for efficient filtering
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// ------------------------------------
// Initialize Mapbox map
// ------------------------------------
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [-71.0589, 42.3601], // Boston
  zoom: 12,
});

// ------------------------------------
// Convert station lat/lon → pixel coords
// ------------------------------------
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// ------------------------------------
// WAIT FOR MAP TO LOAD
// ------------------------------------
map.on("load", async () => {
  console.log("🔥 Map loaded — loading data…");

  // ------------------------------------
  // 1. Add Boston bike lanes
  // ------------------------------------
  map.addSource("boston_lanes", {
    type: "geojson",
    data: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson",
  });

  map.addLayer({
    id: "boston_lanes",
    type: "line",
    source: "boston_lanes",
    paint: { "line-color": "#2ecc71", "line-width": 3 },
  });

  // ------------------------------------
  // 2. Add Cambridge bike lanes
  // ------------------------------------
  map.addSource("cambridge_lanes", {
    type: "geojson",
    data: "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson",
  });

  map.addLayer({
    id: "cambridge_lanes",
    type: "line",
    source: "cambridge_lanes",
    paint: { "line-color": "#27ae60", "line-width": 3 },
  });

  console.log("✅ Bike lanes added!");

  // ------------------------------------
  // 3. Load Bluebikes station JSON
  // ------------------------------------
  const STATIONS_URL =
    "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";

  let jsonData = await d3.json(STATIONS_URL);
  let stations = jsonData.data.stations.filter(
    (d) =>
      d.lat != null &&
      d.lon != null &&
      !isNaN(+d.lat) &&
      !isNaN(+d.lon)
  );

  console.log("📍 Loaded stations:", stations.length);

  // ------------------------------------
  // 4. Load Bluebikes traffic CSV
  // ------------------------------------
  const TRAFFIC_URL =
    "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";

  let trips = await d3.csv(
    TRAFFIC_URL,
    (trip) => {
      // Parse date strings into Date objects
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      
      // Add trips into their respective minute buckets
      let startedMinutes = minutesSinceMidnight(trip.started_at);
      departuresByMinute[startedMinutes].push(trip);
      
      // TODO: Same for arrivals
      let endedMinutes = minutesSinceMidnight(trip.ended_at);
      arrivalsByMinute[endedMinutes].push(trip);
      
      return trip;
    }
  );
  
  console.log("🚴 Loaded trips:", trips.length);

  // Use the computeStationTraffic function to calculate traffic (defaults to all trips)
  stations = computeStationTraffic(jsonData.data.stations);

  console.log("📊 Stations with traffic:", stations);

  // ------------------------------------
  // 5. Circle size scale (Square Root)
  // ------------------------------------
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // ------------------------------------
  // 5.5. Station flow quantize scale
  // ------------------------------------
  const stationFlow = d3
    .scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

  // ------------------------------------
  // 6. Create SVG overlay DYNAMICALLY
  // ------------------------------------
  const container = d3.select("#map");
  
  // Remove any existing SVG first
  container.select("svg").remove();
  
  // Create new SVG overlay
  const svg = container
    .append("svg")
    .style("position", "absolute")
    .style("top", "0")
    .style("left", "0")
    .style("width", "100%")
    .style("height", "100%")
    .style("pointer-events", "none");

  // ------------------------------------
  // 7. Draw circles with traffic-based sizing
  // ------------------------------------
  const circles = svg
    .selectAll("circle")
    .data(stations, (d) => d.short_name) // Use short_name as the key
    .enter()
    .append("circle")
    .attr("cx", (d) => getCoords(d).cx)
    .attr("cy", (d) => getCoords(d).cy)
    .attr("r", (d) => radiusScale(d.totalTraffic))
    .attr("stroke", "white")
    .attr("stroke-width", 1)
    .attr("opacity", 0.6)
    .style("--departure-ratio", (d) => 
      stationFlow(d.departures / d.totalTraffic)
    )
    .each(function (d) {
      // Tooltip <title>
      d3.select(this)
        .append("title")
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

  // ------------------------------------
  // 8. Update positions when map moves
  // ------------------------------------
  function updatePositions() {
    circles
      .attr("cx", (d) => getCoords(d).cx)
      .attr("cy", (d) => getCoords(d).cy);
  }

  updatePositions();

  map.on("move", updatePositions);
  map.on("zoom", updatePositions);
  map.on("resize", updatePositions);
  map.on("moveend", updatePositions);

  console.log("🎉 Finished — stations + traffic on map!");

  // ------------------------------------
  // 9. Time slider interactivity
  // ------------------------------------
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // Function to update the scatterplot based on time filter
  function updateScatterPlot(timeFilter) {
    // Recompute station traffic based on the time filter
    // computeStationTraffic now handles trip filtering internally
    const filteredStations = computeStationTraffic(stations, timeFilter);

    // Update the radius scale range based on whether filtering is applied
    timeFilter === -1 
      ? radiusScale.range([0, 25]) 
      : radiusScale.range([3, 50]);

    // Update the scatterplot by adjusting the radius of circles
    svg
      .selectAll("circle")
      .data(filteredStations, (d) => d.short_name) // Ensure D3 tracks elements correctly
      .join("circle") // Ensure the data is bound correctly
      .attr("r", (d) => radiusScale(d.totalTraffic)) // Update circle sizes
      .style("--departure-ratio", (d) => 
        stationFlow(d.departures / d.totalTraffic)
      )
      .select("title") // Update tooltips
      .text(
        (d) => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
      );
  }

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value); // Get slider value

    if (timeFilter === -1) {
      selectedTime.textContent = ''; // Clear time display
      anyTimeLabel.style.display = 'block'; // Show "(any time)"
    } else {
      selectedTime.textContent = formatTime(timeFilter); // Display formatted time
      anyTimeLabel.style.display = 'none'; // Hide "(any time)"
    }

    // Call updateScatterPlot to reflect the changes on the map
    updateScatterPlot(timeFilter);
  }

  // Bind slider input event to updateTimeDisplay
  timeSlider.addEventListener('input', updateTimeDisplay);
  
  // Initialize the display
  updateTimeDisplay();
});