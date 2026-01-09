
async function fetchText(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error(`Failed to load ${path}`);
  return await res.text();
}

// minimal CSV parser (no quoted commas support beyond basic)
function parseCSV(text){
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length>0);
  const header = lines[0].split(",").map(s=>s.trim());
  const rows = [];
  for(let i=1;i<lines.length;i++){
    const parts = [];
    let cur="", inQuotes=false;
    for(let j=0;j<lines[i].length;j++){
      const ch = lines[i][j];
      if(ch === '"' ){
        inQuotes = !inQuotes;
      } else if(ch === "," && !inQuotes){
        parts.push(cur);
        cur="";
      } else {
        cur += ch;
      }
    }
    parts.push(cur);
    const obj = {};
    header.forEach((h,idx)=> obj[h]= (parts[idx]??"").replace(/^"|"$/g,"").trim());
    rows.push(obj);
  }
  return rows;
}

function uniq(arr){ return Array.from(new Set(arr)); }

function periodIdx(periodsById, periodId){
  const p = periodsById.get(periodId);
  return p ? Number(p.sort_order) : 999;
}

function containsAnyPipe(field, selectedSet){
  if(selectedSet.size===0) return true;
  const vals = (field||"").split("|").map(s=>s.trim()).filter(Boolean);
  return vals.some(v=>selectedSet.has(v));
}

(async function main(){
  const [booksTxt, clustersTxt, instTxt, periodsTxt, edgesTxt] = await Promise.all([
    fetchText("books.csv"),
    fetchText("clusters.csv"),
    fetchText("institutions.csv"),
    fetchText("periods.csv"),
    fetchText("edges.csv"),
  ]);

  const books = parseCSV(booksTxt);
  const clusters = parseCSV(clustersTxt);
  const insts = parseCSV(instTxt);
  const periods = parseCSV(periodsTxt);
  const edges = parseCSV(edgesTxt);

  const clustersById = new Map(clusters.map(c=>[c.cluster_id,c]));
  const instById = new Map(insts.map(i=>[i.inst_id,i]));
  const periodsById = new Map(periods.map(p=>[p.period_id,p]));
  const periodsSorted = [...periods].sort((a,b)=>Number(a.sort_order)-Number(b.sort_order));

  // Controls
  const clusterSelect = document.getElementById("clusterSelect");
  const instChecks = document.getElementById("instChecks");
  const timeSlider = document.getElementById("timeSlider");
  const timeLabel = document.getElementById("timeLabel");
  const searchBox = document.getElementById("searchBox");
  const anchoredOnly = document.getElementById("anchoredOnly");
  const showLabels = document.getElementById("showLabels");

  timeSlider.min = 0;
  timeSlider.max = periodsSorted.length-1;
  timeSlider.value = periodsSorted.length-1;

  // Populate cluster dropdown
  const clusterOptions = [{cluster_id:"__all__", cluster_name:"All clusters"}].concat(
    [...clusters].sort((a,b)=>Number(a.sort_order)-Number(b.sort_order))
  );
  clusterOptions.forEach(c=>{
    const opt=document.createElement("option");
    opt.value=c.cluster_id;
    opt.textContent=c.cluster_name;
    clusterSelect.appendChild(opt);
  });

  // Cluster dropdown listener
  clusterSelect.addEventListener("change", ()=>{ update(); });

  // Institutions checkboxes
  const selectedInst = new Set();
  insts
    .filter(i=>i.inst_id!=="inst_unknown")
    .sort((a,b)=>Number(a.ring_order)-Number(b.ring_order))
    .forEach(i=>{
      const label=document.createElement("label");
      label.className="small";
      const cb=document.createElement("input");
      cb.type="checkbox";
      cb.value=i.inst_id;
      cb.addEventListener("change", ()=>{
        if(cb.checked) selectedInst.add(cb.value);
        else selectedInst.delete(cb.value);
        update();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" "+i.inst_name));
      instChecks.appendChild(label);
    });

  let chronoLayer="produced"; // produced | analyzes

  document.querySelectorAll('input[name="chrono"]').forEach(r=>{
    r.addEventListener("change", ()=>{
      chronoLayer = document.querySelector('input[name="chrono"]:checked').value;
      anchoredOnly.disabled = chronoLayer !== "analyzes";
      if(chronoLayer !== "analyzes") anchoredOnly.checked = false;
      update();
    });
  });

  anchoredOnly.addEventListener("change", update);
  timeSlider.addEventListener("input", update);
  searchBox.addEventListener("input", update);
  showLabels.addEventListener("change", ()=>{
    d3.selectAll(".node text").style("display", showLabels.checked ? "block":"none");
  });

  // SVG setup
  const svg = d3.select("#svg");
  const gLinks = svg.append("g").attr("class","links");
  const gNodes = svg.append("g").attr("class","nodes");

  function resize(){
    const rect = document.getElementById("viz").getBoundingClientRect();
    svg.attr("width", rect.width).attr("height", rect.height);
  }
  window.addEventListener("resize", ()=>{ resize(); update(); });
  resize();

  const color = d3.scaleOrdinal(d3.schemeTableau10);

  function currentPeriodMax(){
    const idx = Number(timeSlider.value);
    return periodsSorted[idx];
  }

  function inChronoWindow(b){
    const maxP = currentPeriodMax();
    const maxOrder = Number(maxP.sort_order);

    if(chronoLayer === "produced"){
      const p = periodsById.get(b.produced_period);
      const order = p ? Number(p.sort_order) : 999;
      return order <= maxOrder;
    }

    // analyzes layer
    const ap = (b.analyzes_periods||"").split("|").map(s=>s.trim()).filter(Boolean);
    if(ap.length===0){
      return anchoredOnly.checked ? false : true;
    }
    return ap.some(pid=>{
      const p = periodsById.get(pid);
      const order = p ? Number(p.sort_order) : 999;
      return order <= maxOrder;
    });
  }

  let simulation;

  function update(){
    const maxP = currentPeriodMax();
    timeLabel.textContent = `${maxP.label} (${maxP.start_year}–${maxP.end_year}) — ${chronoLayer === "produced" ? "Produced-in" : "Analyzes-period"}`;

    const clusterFilter = clusterSelect.value;
    const q = (searchBox.value||"").trim().toLowerCase();

    const visibleBooks = books.filter(b=>{
      if(clusterFilter !== "__all__" && b.cluster_id !== clusterFilter) return false;
      if(!containsAnyPipe(b.institutions, selectedInst)) return false;
      if(!inChronoWindow(b)) return false;
      if(q){
        const hay = `${b.title} ${b.authors}`.toLowerCase();
        if(!hay.includes(q)) return false;
      }
      return true;
    });

    const nodes = visibleBooks.map(b=>({
      id: b.book_id,
      title: b.title,
      authors: b.authors,
      url: b.source_url,
      cluster_id: b.cluster_id,
      institutions: b.institutions,
      produced_period: b.produced_period,
      analyzes_periods: b.analyzes_periods,
      confidence: b.confidence,
      status: b.status,
      provenance: b.provenance
    }));

    const nodeSet = new Set(nodes.map(n=>n.id));
    const links = edges
      .filter(e=> nodeSet.has(e.from_id) && nodeSet.has(e.to_id))
      .map(e=>({
        source: e.from_id,
        target: e.to_id,
        weight: Number(e.weight||1),
        type: e.edge_type||""
      }));

    // Draw
    gLinks.selectAll("*").remove();
    gNodes.selectAll("*").remove();

    const linkSel = gLinks.selectAll("line")
      .data(links, d=>`${d.source}__${d.target}`)
      .enter().append("line")
      .attr("class", d=> d.weight>=3 ? "link thick":"link");

    const nodeSel = gNodes.selectAll("g")
      .data(nodes, d=>d.id)
      .enter().append("g")
      .attr("class","node")
      .call(d3.drag()
        .on("start", (event,d)=>{ if(!event.active) simulation.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
        .on("drag", (event,d)=>{ d.fx=event.x; d.fy=event.y; })
        .on("end", (event,d)=>{ if(!event.active) simulation.alphaTarget(0); d.fx=null; d.fy=null; })
      );

    nodeSel.append("circle")
      .attr("r", 6)
      .attr("fill", d=> color(d.cluster_id));

    nodeSel.append("text")
      .text(d=> d.title.length>28 ? d.title.slice(0,28)+"…" : d.title)
      .attr("x", 9)
      .attr("y", 3)
      .style("display", showLabels.checked ? "block":"none");

    nodeSel.on("click", (event,d)=>{
      const c = clustersById.get(d.cluster_id);
      const produced = periodsById.get(d.produced_period);
      const ap = (d.analyzes_periods||"").split("|").filter(Boolean).map(pid=>periodsById.get(pid)?.label||pid);
      const instLabels = (d.institutions||"").split("|").filter(Boolean).map(i=>instById.get(i)?.inst_name||i);

      document.getElementById("detailsBody").innerHTML = `
        <div style="font-weight:700">${escapeHtml(d.title)}</div>
        <div class="small" style="margin-top:4px">${escapeHtml(d.authors||"")}</div>
        <div class="small" style="margin-top:8px"><b>Cluster:</b> ${escapeHtml(c?.cluster_name||d.cluster_id)}</div>
        <div class="small" style="margin-top:4px"><b>Institutions:</b> ${escapeHtml(instLabels.join(", "))}</div>
        <div class="small" style="margin-top:4px"><b>Produced:</b> ${escapeHtml(produced?.label||d.produced_period)}</div>
        <div class="small" style="margin-top:4px"><b>Analyzes:</b> ${escapeHtml(ap.length?ap.join(", "):"—")}</div>
        <div class="small" style="margin-top:4px"><b>Status:</b> ${escapeHtml(d.status)} / ${escapeHtml(d.provenance)} (conf ${escapeHtml(d.confidence||"")})</div>
        <div style="margin-top:10px">
          ${d.url ? `<a href="${d.url}" target="_blank" rel="noreferrer">Open source link</a>` : ""}
        </div>
      `;
    });

    if(simulation) simulation.stop();

    const rect = document.getElementById("viz").getBoundingClientRect();
    simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d=>d.id).distance(70).strength(0.6))
      .force("charge", d3.forceManyBody().strength(-120))
      .force("center", d3.forceCenter(rect.width/2, rect.height/2))
      .force("collide", d3.forceCollide().radius(12));

    simulation.on("tick", ()=>{
      linkSel
        .attr("x1", d=>d.source.x)
        .attr("y1", d=>d.source.y)
        .attr("x2", d=>d.target.x)
        .attr("y2", d=>d.target.y);

      nodeSel.attr("transform", d=>`translate(${d.x},${d.y})`);
    });
  }

  function escapeHtml(str){
    return (str||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
  }

  update();
})();
