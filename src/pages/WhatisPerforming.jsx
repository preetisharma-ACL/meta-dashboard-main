import { createSignal, createMemo, For } from "solid-js";
import { onMount, onCleanup } from "solid-js";

const WhatIsPerforming = () => {

  const [city, setCity] = createSignal("");
  const [rera, setRera] = createSignal("");
  const [type, setType] = createSignal("");
  const [budget, setBudget] = createSignal("");
  const [stage, setStage] = createSignal("");
  const [activeMenu, setActiveMenu] = createSignal(null);
  const [editIndex, setEditIndex] = createSignal(null);
  const [projects, setProjects] = createSignal([
    {
      name: "ABC Greens Villas",
      city: "Gurugram",
      type: "Villa",
      rera: "RERA Approved",
      budget: "Under 1 Cr",
      budgetValue: 9000000,
      stage: "New Launch",
      developer: "ABC Group",
      rm: 3,
      cpl: "₹200–₹400",
      leads: "500/month",
      estimation: "₹30–40k / 100 leads",
      qualification: "Medium–High",
    },
    {
      name: "XYZ Heights",
      city: "Noida",
      type: "High Rise",
      rera: "Without RERA",
      budget: "1–2 Cr",
      budgetValue: 15000000,
      stage: "Sustenance",
      developer: "XYZ Builder",
      rm: 2,
      cpl: "₹100–₹250",
      leads: "300/month",
      estimation: "₹25–30k / 100 leads",
      qualification: "Medium",
    },
    {
      name: "XYZ Corp",
      city: "Greater Noida",
      type: "High Rise",
      rera: "Without RERA",
      budget: "90000Cr",
      budgetValue: 20000000,
      stage: "Sustenance",
      developer: "XYZ Builder",
      rm: 2,
      cpl: "₹300–₹600",
      leads: "300/month",
      estimation: "₹25–30k / 100 leads",
      qualification: "Medium",
    }]);

  //  Sample Data (Replace with API later)

  const [isOpen, setIsOpen] = createSignal(false);
  const [formData, setFormData] = createSignal({
    name: "",
    city: "",
    type: "",
    rera: "",
    budget: "",
    budgetValue: "",
    stage: "",
    developer: "",
    rm: "",
    cpl: "",
    leads: "",
    estimation: "",
    qualification: "",
  });
  onMount(() => {
    const handleClick = (e) => {
      // 🔥 only close if NOT clicking on menu or button
      if (!e.target.closest(".menu-container")) {
        setActiveMenu(null);
      }
    };

    document.addEventListener("click", handleClick);

    onCleanup(() => {
      document.removeEventListener("click", handleClick);
    });
  });

  // 🔹 Filter Logic
  const filteredProjects = createMemo(() => {
    return projects().filter((p) => {

      const cityMatch =
        !city() ||
        city() === "" ||
        city().split("|").map(c => c.trim()).includes(p.city);

      const reraMatch =
        !rera() || p.rera === rera();

      const typeMatch =
        !type() ||
        p.type.toLowerCase().includes(type().toLowerCase());

      const stageMatch =
        !stage() || p.stage === stage();

      const budgetMatch = (() => {
        if (!budget()) return true;

        const value = p.budgetValue || 0;

        if (budget() === "Under 1 Cr") return value <= 10000000;
        if (budget() === "1–2 Cr") return value > 10000000 && value <= 20000000;
        if (budget() === "2–3 Cr") return value > 20000000 && value <= 30000000;
        if (budget() === "3–5 Cr") return value > 30000000 && value <= 50000000;

        return true;
      })();

      return cityMatch && reraMatch && typeMatch && stageMatch && budgetMatch;
    });
  });

  const formatCPL = (value) => {
    if (!value) return "";

    // remove ₹ and spaces
    let clean = value.replace(/₹/g, "").trim();

    // replace - with proper dash
    clean = clean.replace("-", "–");

    // split values
    const parts = clean.split("–");

    // add ₹ before each number
    const formatted = parts
      .map((p) => `₹${p.trim()}`)
      .join("–");

    return formatted;
  };
  const formatEstimation = (value) => {
    if (!value) return "";

    let clean = value.replace(/₹/g, "").trim();

    // replace - with proper dash
    clean = clean.replace("-", "–");

    // ensure slash exists
    if (!clean.includes("/")) {
      const parts = clean.split(" ");
      if (parts.length >= 2) {
        clean = `${parts[0]} / ${parts.slice(1).join(" ")}`;
      }
    }

    // add ₹ at start
    if (!clean.startsWith("₹")) {
      clean = `₹${clean}`;
    }

    return clean;
  };
  // Edit
  const handleEdit = (project, index) => {
    setFormData(project);
    setEditIndex(index); //  important
    setIsOpen(true);
  };
  // Delete
  const handleDelete = (index) => {
    const updated = projects().filter((_, i) => i !== index);
    setProjects(updated);
  };
  return (
    <div class="p-4 md:p-6 min-h-screen bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      {/* HEADER */}
      <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-6">
        <div>
          <h1 class="text-2xl md:text-2xl font-semibold mb-1">Performing Projects</h1>
          <p class="text-md text-gray-700 dark:text-gray-400">Discover top-performing projects based on historical and regional data.</p>
        </div>
        <div class="flex gap-2">
          <button
            onClick={() => setIsOpen(true)}
            class="px-4 py-2.5 text-sm font-medium rounded 
            bg-blue-900 text-white hover:bg-blue-700 transition-all"
          >
            + Add Project
          </button>
        </div>
      </div>

      {/* FILTERS */}
      <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-6 space-y-4">

        <div class="grid grid-cols-2 md:grid-cols-6 gap-3">

          <select class="input-ui shadow hover:shadow-md " value={city()} onChange={(e) => setCity(e.target.value)}>
            <option value="">City</option>
            <option>Noida | Greater Noida </option>
            <option>Delhi</option>
            <option>Faridabad</option>
            <option>Ghaziabad</option>
            <option>Gurugram</option>
            <option>Bangalore</option>
            <option>Pune </option>
            <option>Mumbai </option>
            <option>Hyderabad </option>
            <option>Lucknow </option>
            <option>Kolkata </option>
            <option>Ahemadabad </option>
            <option>Dholera </option>
          </select>

          <select class="input-ui shadow hover:shadow-md " value={rera()} onChange={(e) => setRera(e.target.value)}>
            <option value="">RERA</option>
            <option>RERA Approved</option>
            <option>Without RERA</option>
          </select>

          <select class="input-ui shadow hover:shadow-md" value={type()} onChange={(e) => setType(e.target.value)}>
            <option value="">Property Type</option>
            <option>Villa</option>
            <option>Plots / Land</option>
            <option>High Rise Apartments</option>
            <option>Low Rise Floors</option>
            <option>Studio Apartments</option>
            <option>Builder Floors</option>
            <option>Branded Residences</option>
            <option>Farmhouses</option>
          </select>

          <select class="input-ui shadow hover:shadow-md" value={budget()} onChange={(e) => setBudget(e.target.value)}>
            <option value="">Budget</option>
            <option>Under 1 Cr</option>
            <option>1–2 Cr</option>
            <option>2–3 Cr</option>
            <option>3–5 Cr</option>
          </select>

          <select class="input-ui shadow hover:shadow-md" value={stage()} onChange={(e) => setStage(e.target.value)}>
            <option value="">Stage</option>
            <option>New Launch</option>
            <option>Sustenance</option>
          </select>

          <div class="flex items-center space-x-2">
            <button class="px-3 py-2 rounded text-sm font-medium 
              bg-blue-900 text-white hover:bg-blue-800 transition-all"
              onClick={() => {
                setCity("");
                setRera("");
                setType("");
                setBudget("");
                setStage("");
              }}>
              Reset
            </button>
            <span class="text-sm text-gray-500">
              {filteredProjects().length} projects found
            </span>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 mt-3">

          {/* City */}
          {city() && (
            <span class="flex items-center gap-2 px-3 py-1 text-xs rounded-full 
    bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
              {city()}
              <button onClick={() => setCity("")}>✕</button>
            </span>
          )}

          {/* RERA */}
          {rera() && (
            <span class="flex items-center gap-2 px-3 py-1 text-xs rounded-full 
    bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
              {rera()}
              <button onClick={() => setRera("")}>✕</button>
            </span>
          )}

          {/* Budget */}
          {budget() && (
            <span class="flex items-center gap-2 px-3 py-1 text-xs rounded-full 
    bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
              {budget()}
              <button onClick={() => setBudget("")}>✕</button>
            </span>
          )}

          {/* Type */}
          {type() && (
            <span class="flex items-center gap-2 px-3 py-1 text-xs rounded-full 
    bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
              {type()}
              <button onClick={() => setType("")}>✕</button>
            </span>
          )}

          {/* Stage */}
          {stage() && (
            <span class="flex items-center gap-2 px-3 py-1 text-xs rounded-full 
    bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
              {stage()}
              <button onClick={() => setStage("")}>✕</button>
            </span>
          )}
        </div>
      </div>

     
      {/* CARDS */}
      <div class="grid md:grid-cols-2 lg:grid-cols-2 xxl:grid-cols-3 gap-4">

        <For each={filteredProjects()}>
          {(project, index) => (
            <div class="relative overflow-hidden rounded-2xl p-5 transition-all duration-200
        bg-white border border-gray-200 shadow-sm hover:shadow-md hover:-translate-y-0.5
        dark:bg-gray-900 dark:border-gray-700/60 dark:hover:border-gray-600">

              {/* Top accent line */}
              <div class="absolute top-0 left-0 right-0 h-px
          bg-gradient-to-r from-transparent via-gray-300 to-transparent
          dark:via-gray-600" />

              {/* Header */}
              <div class="flex justify-between items-start gap-3 mb-2">
                <h3 class="text-[17px] font-semibold leading-snug
            text-gray-800
            dark:text-gray-100">
                  {project.name}
                </h3>

                <div class="flex items-center gap-2 flex-shrink-0">

                  {/* Badge */}
                  <span class="text-[11px] font-semibold tracking-wide px-2.5 py-0.5 rounded-full
              bg-green-100 text-green-700 border border-green-200
              dark:bg-green-900/40 dark:text-green-400 dark:border-green-800">
                    Performing
                  </span>

                  {/* MENU CONTAINER (IMPORTANT CLASS ) */}
                  <div class="relative menu-container">

                    {/* 3 dots button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenu(activeMenu() === index() ? null : index());
                      }}
                      class="flex items-center justify-center p-1 rounded-md transition-colors duration-150
                  text-gray-800 hover:text-gray-700 hover:bg-gray-100
                  dark:text-gray-500 dark:hover:text-gray-200 dark:hover:bg-gray-800"
                    >
                      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 4a2 2 0 110 4 2 2 0 010-4zm0 6a2 2 0 110 4 2 2 0 010-4zm0 6a2 2 0 110 4 2 2 0 010-4z" />
                      </svg>
                    </button>

                    {/* Dropdown */}
                    {activeMenu() === index() && (
                      <div class="absolute right-0 top-7 w-32 z-50 overflow-hidden rounded-xl shadow-xl
                  bg-white border border-gray-200
                  dark:bg-gray-800 dark:border-gray-700">

                        <button
                          onClick={() => {
                            handleEdit(project, index());
                            setActiveMenu(null);
                          }}
                          class="w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors
                      text-gray-600 hover:bg-gray-50 hover:text-gray-900
                      dark:text-gray-300 dark:hover:bg-gray-700/60 dark:hover:text-white"
                        >
                          <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Edit
                        </button>

                        <div class="h-px bg-gray-100 dark:bg-gray-700" />

                        <button
                          onClick={() => {
                            handleDelete(index());
                            setActiveMenu(null);
                          }}
                          class="w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors
                      text-red-500 hover:bg-red-50 hover:text-red-600
                      dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                        >
                          <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 5v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete
                        </button>

                      </div>
                    )}

                  </div>
                </div>
              </div>

              {/* Meta */}
              <p class="text-sm mb-4 tracking-wide
          text-gray-600
          dark:text-gray-400">
                {project.city}
                <span class="mx-1.5 text-green-800 dark:text-green-600">•</span>
                {project.type}
                <span class="mx-1.5 text-green-800 dark:text-green-600">•</span>
                {project.rera}
              </p>

              {/* Stats Grid */}
              <div class="grid grid-cols-2 gap-2.5 mb-4">

                <div class="rounded-xl p-2.5
            bg-gray-50 border border-gray-100
            dark:bg-gray-800/60 dark:border-gray-700/50">
                  <p class="text-sm  mb-1
              text-gray-500 dark:text-gray-500">Budget</p>
                  <p class="text-sm font-semibold
              text-gray-700 dark:text-gray-200">{project.budgetValue}</p>
                </div>

                <div class="rounded-xl p-2.5
            bg-gray-50 border border-gray-100
            dark:bg-gray-800/60 dark:border-gray-700/50">
                  <p class="text-sm  mb-1
              text-gray-500 dark:text-gray-500">Stage</p>
                  <p class="text-sm font-semibold
              text-gray-700 dark:text-gray-200">{project.stage}</p>
                </div>

                <div class="rounded-xl p-2.5
            bg-gray-50 border border-gray-100
            dark:bg-gray-800/60 dark:border-gray-700/50">
                  <p class="text-sm  mb-1
              text-gray-500 dark:text-gray-500">RM</p>
                  <p class="text-sm font-semibold
              text-gray-700 dark:text-gray-200">{project.rm}</p>
                </div>

                <div class="rounded-xl p-2.5
            bg-gray-50 border border-gray-100
            dark:bg-gray-800/60 dark:border-gray-700/50">
                  <p class="text-sm  mb-1
              text-gray-500 dark:text-gray-500">Developer</p>
                  <p class="text-sm font-semibold
              text-gray-700 dark:text-gray-200">{project.developer}</p>
                </div>

              </div>

              {/* Info Panel */}
              <div class="rounded-xl p-3.5 mb-3.5 flex flex-col gap-2
          bg-gray-50 border border-gray-100
          dark:bg-gray-800/40 dark:border-gray-700/40">

                <div class="flex justify-between items-center text-sm">
                  <span class="text-gray-500 dark:text-gray-400">Tentative CPL</span>
                  <span class="text-[#d4af5a] font-medium">{project.cpl}</span>
                </div>

                <div class="h-px bg-gray-200 dark:bg-gray-700/50" />

                <div class="flex justify-between items-center text-sm">
                  <span class="text-gray-500 dark:text-gray-400">No of leads we can generate</span>
                  <span class="text-[#d4af5a] font-medium">{project.leads}</span>
                </div>

                <div class="h-px bg-gray-200 dark:bg-gray-700/50" />

                <div class="flex justify-between items-center text-sm">
                  <span class="text-gray-500 dark:text-gray-400">Budget required monthly</span>
                  <span class="text-[#d4af5a] font-medium">{project.estimation}</span>
                </div>

                <div class="h-px bg-gray-200 dark:bg-gray-700/50" />

                <div class="flex justify-between items-center text-sm">
                  <span class="text-gray-500 dark:text-gray-400">Qualification</span>
                  <span class="text-[#d4af5a] font-medium">{project.qualification}</span>
                </div>

              </div>

              {/* Note */}
              <div class="text-sm leading-relaxed pt-3 border-t
          text-gray-500 border-gray-100
          dark:text-gray-500 dark:border-gray-700/50">
                <strong class="font-semibold text-gray-500 dark:text-gray-400">Note:</strong> This is an estimated CPL, the sales team will share Final CPL and can be checked in the proposal.
              </div>

            </div>
          )}
        </For>

      </div>

      {isOpen() && (
        <div class="fixed inset-0 z-50 flex">

          {/* Overlay */}
          <div
            class="absolute inset-0 bg-black/40"
            onClick={() => setIsOpen(false)}
          ></div>

          {/* Sidebar */}
          <div class="ml-auto w-full md:w-[650px] h-full bg-white dark:bg-gray-900 shadow-xl p-6 relative z-10 overflow-y-auto">
            <h2 class="text-lg font-semibold mb-5">
              {editIndex() !== null ? "Edit Project" : "Add Project"}
            </h2>
            <hr class="mb-6 border-gray-300 dark:border-gray-700" />

            <div class="grid grid-cols-2 gap-6">

              {/* Project Name */}
              <div class="col-span-2">
                <label class="label">Project Name</label>
                <input
                  class="input-ui  mt-1"
                  placeholder="Enter project name"
                  value={formData().name || ""}
                  onInput={(e) => setFormData({ ...formData(), name: e.target.value })}
                />
              </div>

              {/* City */}
              <div>
                <label class="label">City</label>
                <select
                  class="input-ui  mt-1"
                  value={formData().city || ""}
                  onChange={(e) => setFormData({ ...formData(), city: e.target.value })}
                >
                  <option value="">Select City</option>
                  <option>Noida | Greater Noida </option>
                  <option value="Noida">Noida</option>
                  <option value="Greater Noida">Greater Noida</option>
                  <option>Faridabad</option>
                  <option>Ghaziabad</option>
                  <option>Gurugram</option>
                  <option>Bangalore</option>
                  <option>Pune </option>
                  <option>Mumbai </option>
                  <option>Hyderabad </option>
                  <option>Lucknow </option>
                  <option>Kolkata </option>
                  <option>Ahemadabad </option>
                  <option>Dholera </option>
                </select>
              </div>



              {/* Property Type */}
              <div>
                <label class="label">Property Type</label>
                <select
                  class="input-ui  mt-1"
                  value={formData().type || ""}
                  onChange={(e) => setFormData({ ...formData(), type: e.target.value })}
                >
                  <option value="">Property Type</option>
                  <option>Villa</option>
                  <option>Plots / Land</option>
                  <option value="High Rise">High Rise </option>
                  <option>Low Rise Floors</option>
                  <option>Studio Apartments</option>
                  <option>Builder Floors</option>
                  <option>Branded Residences</option>
                  <option>Farmhouses</option>
                </select>
              </div>

              {/* RERA */}
              <div>
                <label class="label">RERA</label>
                <select
                  class="input-ui  mt-1"
                  value={formData().rera || ""}
                  onChange={(e) => setFormData({ ...formData(), rera: e.target.value })}
                >
                  <option value="">RERA</option>
                  <option>RERA Approved</option>
                  <option>Without RERA</option>
                </select>
              </div>

              {/* Budget */}
              <div>
                <label class="label">Budget</label>
                <select
                  class="input-ui  mt-1"
                  value={formData().budget || ""}
                  onChange={(e) => setFormData({ ...formData(), budget: e.target.value })}
                >
                  <option value="">Select Budget</option>
                  <option>Under 1 Cr</option>
                  <option>1–2 Cr</option>
                  <option>2–3 Cr</option>
                  <option>3–5 Cr</option>
                </select>
              </div>

              {/* Budget Value */}
              <div>
                <label class="label">Budget Value</label>
                <input
                  type="number"
                  class="input-ui  mt-1"
                  value={formData().budgetValue || ""}
                  placeholder="9000000"
                  onInput={(e) =>
                    setFormData({ ...formData(), budgetValue: Number(e.target.value) })
                  }
                />
              </div>

              {/* Stage */}
              <div>
                <label class="label">Stage</label>
                <select
                  class="input-ui  mt-1"
                  value={formData().stage || ""}
                  onChange={(e) => setFormData({ ...formData(), stage: e.target.value })}
                >
                  <option value="">Select Stage</option>
                  <option>New Launch</option>
                  <option>Sustenance</option>
                </select>
              </div>

              {/* Developer */}
              <div>
                <label class="label">Developer</label>
                <input
                  class="input-ui  mt-1"
                  value={formData().developer || ""}
                  placeholder="Enter developer name"
                  onInput={(e) =>
                    setFormData({ ...formData(), developer: e.target.value })
                  }
                />
              </div>

              {/* RM */}
              <div>
                <label class="label">RM</label>
                <input
                  class="input-ui  mt-1"
                  value={formData().rm || ""}
                  type="number"
                  placeholder="Enter RM value"
                  onInput={(e) =>
                    setFormData({ ...formData(), rm: e.target.value })
                  }
                />
              </div>

              <div class="col-span-2 grid grid-cols-2 gap-6 p-3 border rounded-lg border-gray-300 dark:border-gray-700">
                {/* CPL */}
                <div>
                  <label class="label">Tentative CPL</label>
                  <input
                    class="input-ui mt-1"

                    placeholder="Ex- ₹200–₹400"
                    value={formData().cpl || ""}
                    onInput={(e) =>
                      setFormData({ ...formData(), cpl: e.target.value })
                    }
                    onBlur={(e) => {
                      const formatted = formatCPL(e.target.value);
                      setFormData({ ...formData(), cpl: formatted });
                    }}
                  />
                </div>

                {/* Leads */}
                <div>
                  <label class="label">No of leads we can generate</label>
                  <input
                    class="input-ui  mt-1"
                    value={formData().leads || ""}
                    placeholder="Ex- 500/month"
                    onInput={(e) =>
                      setFormData({ ...formData(), leads: e.target.value })
                    }
                  />
                </div>

                {/* Estimation */}
                <div>
                  <label class="label"> budget required monthly </label>
                  <input
                    class="input-ui mt-1"
                    value={formData().estimation || ""}
                    placeholder="Ex- ₹30–40k / 100 leads"
                    onInput={(e) =>
                      setFormData({ ...formData(), estimation: e.target.value })
                    }
                    onBlur={(e) => {
                      const formatted = formatEstimation(e.target.value);
                      setFormData({ ...formData(), estimation: formatted });
                    }}
                  />
                </div>

                {/* Qualification */}
                <div>
                  <label class="label ">Qualification</label>
                  <input
                    class="input-ui mt-1"
                    value={formData().qualification || ""}
                    placeholder="Ex- Medium–High"
                    onInput={(e) =>
                      setFormData({ ...formData(), qualification: e.target.value })
                    }
                  />
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div class="flex gap-2 mt-6">
              <button
                onClick={() => {
                  if (editIndex() !== null) {
                    // ✏️ UPDATE EXISTING PROJECT
                    const updated = projects().map((p, i) =>
                      i === editIndex() ? formData() : p
                    );
                    setProjects(updated);
                  } else {
                    // ➕ ADD NEW PROJECT
                    setProjects([...projects(), formData()]);
                  }

                  // reset state
                  setEditIndex(null);
                  setIsOpen(false);

                  setFormData({
                    name: "",
                    city: "",
                    type: "",
                    rera: "",
                    budget: "",
                    budgetValue: "",
                    stage: "",
                    developer: "",
                    rm: "",
                    cpl: "",
                    leads: "",
                    estimation: "",
                    qualification: "",
                  });
                }}
                class="bg-blue-900 text-white py-2 px-6 rounded-lg hover:bg-blue-700"
              >
                {editIndex() !== null ? "Update" : "Save"}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                class=" bg-gray-300 dark:bg-gray-700 py-2 px-6 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatIsPerforming;