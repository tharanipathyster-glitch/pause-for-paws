# Pause for Paws
## Six-slide student presentation

### Slide 1: The problem
- Animals sometimes cross roads to find food, water, or shelter.
- Vehicles can hit animals, and people can be hurt too.
- Some roads have more wildlife crossings than others.
- Our goal is to help drivers slow down in those areas.

**Say:** Pause for Paws uses information about past wildlife crossings to help identify roads where drivers should pay extra attention.

### Slide 2: Where the information comes from
- Historical coordinate data tells us where an event happened.
- Each event can include a location, date, animal type, and confidence score.
- Our test data is synthetic, meaning it was created for practice.
- Real data would need permission from a wildlife agency, road department, or approved partner.

**Say:** We never pretend that practice data is real. That is important for safety and honesty.

### Slide 3: How the map works
- The map places historical events near their coordinates.
- Nearby events are grouped into a corridor.
- A corridor is a longer part of a road, not just one point.
- Areas with repeated events receive a higher risk score.

**Say:** A corridor pattern is more useful than saying an animal is definitely at one exact spot right now.

### Slide 4: The Pause for Paws message
- A driver approaches a known risk area.
- The system can show: **Pause for Paws**.
- The message tells the driver to slow down and watch both shoulders.
- Historical data cannot prove that an animal is there right now.

**Say:** This is a safety reminder, not a promise that an animal is currently on the road.

### Slide 5: What makes our idea useful
- It combines map coordinates with animal and seasonal information.
- It turns many old reports into easy-to-understand corridor patterns.
- It can help agencies choose signs, fencing, crossings, or patrol areas.
- It can be tested with a simulator before being used by drivers.

**Say:** Our idea helps people make better decisions while keeping the message simple.

### Slide 6: Our next steps
- Replace practice data with verified, permission-based data.
- Test the system with a wildlife agency and transportation department.
- Check that alerts are accurate and do not distract drivers.
- Protect API keys and personal location information.
- Ask lawyers to review privacy, data licenses, and patents.

**Say:** Pause for Paws is a working prototype. It needs expert testing and official approval before it can be used on real roads.

## Questions a wildlife ranger may ask

### 1. Is your data real?
**Answer:** Not yet. Our current data is synthetic test data. We would only use real data after receiving permission from an agency or approved partner.

### 2. How do you know the animal is really there?
**Answer:** We do not know from historical data alone. We describe a repeated risk pattern, not a live animal location.

### 3. Could the map make drivers panic?
**Answer:** The message is designed to be calm and simple: slow down and watch both shoulders. We would test the wording with safety experts.

### 4. How accurate are the coordinates?
**Answer:** Accuracy depends on the data provider. We would record the coordinate source and accuracy, remove duplicates, and avoid showing false precision.

### 5. Which animals are most at risk?
**Answer:** That depends on the location. The system can group results by species, but a ranger or biologist should check the interpretation.

### 6. Does this change the driver’s route?
**Answer:** No. The prototype shows a warning layer. It does not change Google Maps routing.

### 7. What happens if an area has no recent reports?
**Answer:** The system should lower or expire the risk status. It should never leave an old warning active forever.

### 8. Could people use this to find rare animals?
**Answer:** We should hide sensitive wildlife locations and show only a broad road corridor, especially for endangered species.

### 9. Who would pay for this?
**Answer:** Transportation departments, parks, road agencies, and fleet operators could pay for planning tools and safety alerts. Grants and conservation sponsors could also help.

### 10. How would you prove it helps?
**Answer:** Run a controlled pilot and compare vehicle speeds, near misses, wildlife collisions, and driver feedback before and after the warning system.
