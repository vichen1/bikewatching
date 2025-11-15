import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

const MAPBOX_TOKEN =
  "pk.eyJ1IjoidmljaGVuMSIsImEiOiJjbWh6ZnYyNnMwbjc2MnFvZjVhaWJuYjRwIn0.7-MNkrqe-P0bNG-qk3EZ9A";

mapboxgl.accessToken = MAPBOX_TOKEN;


function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); 
  return date.toLocaleString('en-US', { timeStyle: 'short' }); 
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}


function filterTripsByTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips 
    : trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}


function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}

let timeFilter = -1;


const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [-71.0589, 42.3601],
  zoom: 12,
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}


map.on("load", async () => {
  console.log("🔥 Map loaded — loading data…");

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

  const TRAFFIC_URL =
    "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";

  let trips = await d3.csv(
    TRAFFIC_URL,
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    }
  );
  
  console.log("🚴 Loaded trips:", trips.length);

  stations = computeStationTraffic(jsonData.data.stations, trips);

  console.log("📊 Stations with traffic:", stations);

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  const container = d3.select("#map");
  
  container.select("svg").remove();
  
  const svg = container
    .append("svg")
    .style("position", "absolute")
    .style("top", "0")
    .style("left", "0")
    .style("width", "100%")
    .style("height", "100%")
    .style("pointer-events", "none");

  const circles = svg
    .selectAll("circle")
    .data(stations, (d) => d.short_name) 
    .enter()
    .append("circle")
    .attr("cx", (d) => getCoords(d).cx)
    .attr("cy", (d) => getCoords(d).cy)
    .attr("r", (d) => radiusScale(d.totalTraffic))
    .attr("fill", "steelblue")
    .attr("stroke", "white")
    .attr("stroke-width", 1)
    .attr("opacity", 0.6)
    .each(function (d) {
      // Tooltip <title>
      d3.select(this)
        .append("title")
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

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


  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateScatterPlot(timeFilter) {
    const filteredTrips = filterTripsByTime(trips, timeFilter);

    const filteredStations = computeStationTraffic(stations, filteredTrips);

    timeFilter === -1 
      ? radiusScale.range([0, 25]) 
      : radiusScale.range([3, 50]);

    svg
      .selectAll("circle")
      .data(filteredStations, (d) => d.short_name) 
      .join("circle") 
      .attr("r", (d) => radiusScale(d.totalTraffic)) 
      .select("title") 
      .text(
        (d) => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
      );
  }

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value); 

    if (timeFilter === -1) {
      selectedTime.textContent = ''; 
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  
  updateTimeDisplay();
});