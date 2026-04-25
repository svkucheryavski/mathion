# Mathion - a lightweight open source LMS (learning management system)

> **Note:** This document captures the original vision for the project. It is preserved for historical context. The current platform design and phase-by-phase specs live in `docs/superpowers/specs/`, and implementation plans in `docs/superpowers/plans/`.

I want to create an e-learning system for providing access to online courses or to online part of conventional courses. I want to have this platform as open source prohect, so anyone can use it.  The basic idea is to make something similar to Open edX platform. However, I want to make it much simpler, faster, and with better UI/UX.

The preliminary name is "mathion" from Greek "Máthēma" which means a lesson. I have already purchased domain "mathion.org" for the project.

The platform should have three "parts" (or views). One for students for taking a course, following own progress and communicating with teachers. One for teachers, to give students access to a course, provide feedback, check their progress. One for administrators to manage courses, users, etc.

It is expected that the platform will be used by middle size organizations, with 1000-50000 registered users and with 100-5000 users taking courses every day.

Below is the desciption of main elements of the system, technical details, etc. — how I see them.

The main elements of the platform are courses and users.

Let's start with the courses.

## Courses

Any course consists of blocks. Every block consists of learning sequences. Every learning sequence consists of items.

Any course has versions, so the same course can exists in several versions. All versions share the name and description of the course but may have different content. Versions are needed to make the active course content immutable. Once the course is published and has at least one student who is taking it, course administrators can not change the course elements. They can still correct the content of course items (e.g. to fix a typo or broken link), but removing, re-arrenging or adding new blocks, sequences or items is forbidden. If any changes like these should be made, a new version of the course must be created.

When a new version of a course is created the system creates a copy of all blocks, sequences, items and related assets from the latest version. A course version has three states:

*created*: new version not available for users, any changes can be made, including removing, addition and rearranging of blocks, sequences, items and assets. Only course administrators can introduce these changes and can try this course in live form. When all changes are ready the administrators "publish" the course chaninging its status to "published". Administrators can also add role "teacher" to this course, but teachers will not be able to see it until it is published.

*published*: the version is ready to be used by students, course administrators can only change content of items (e.g. fix typos). Teachers can add students to the course.

*archived*: the version is retired, it is not possible assign new students (but all course activities are stored) or teachers. Students who already assigned to this version before it became archived continue having access to all course content but they see a mark that the course is archived and the new version is available.

All student progress is connected to a particular course version. If they want to take a new version, they start from the scratch.

A course version can be deleted only if it is in the *created* state. Once it is published or archived, it is there forever. This is needed to save all course activites related to course users (students).

In addition to the state, blocks, sequences, and items a course version also has:
- information: rich text with general information about the course
- creation date: date and time the version has been created
- publishing date: date and time the version has been published (null by default)
- archived date: date and time the version has been archived (null by default)
- administrators: list of users who can edit this version and assign teachers
- teachers: list of users who allow see the student progress but can not edit the course content.
- students: list of users who allow to see the course content for learning.

Student, administrator and teacher - are roles, a person can have all three roles for the same course version. More details about the users and the roles is in other chapter of this document.

### Blocks

Block is a simple element which aims at providing a specific hierarchy to any course version. Block has a name, an order number (1, 2, 3), a short info (e.g. learning goals). Block has one or several learning sequences, empty blocks (without learning sequences) are not allowed in published state of a course version.

Here is an example of blocks (B) for course on Applied statistics:

B1. Descriptive statistics and plots
B2. Inferential statistics
B3. Covariance, correlation and regression
B4. Non-parametric methods

There should be a reasonable limitation for the maximum number of blocks in the course, e.g. maximum six or eight blocks. If more is needed it is better to split the course into two.


### Learning sequences

Learning sequence is a sequence of items, which users should go through to achive learning goals. It corresponds to what is known as a combination of lecture+seminar in traditional teaching. One block can have between 1 and 8 learning sequences (3-4 is most optimal). Here are examples of three learning sequences (LS) for Block 1 from the previous section:

B1. Descriptive statistics and plots
   LS1. Quantiles, quartiles, percentiles.
   LS2. Parametric approach, distribution histograms, theoretical distributions.
   Ls3. Normal distribution and its properties.


### Learning items

Learning items are "atoms" of any course, they are elements of the learning sequence. There are four different learning items:

* static page
* video
* quiz
* interactive app

Perhaps later this list will be extended. Every item has a short title.

When user opens any item system counts how long it stays on the item and after certaint time (e.g. 30 seconds) marks this item as covered. For videos the time should correspond to the time of the video. Perhaps every item type should have own rule for this. This (covered status) is needed only for visual indication.

Here are details about each type:

#### Static page

Is a simple page to provide some information to a student. It can contain images, formatted text, hyperlinks (including links to locally stored files). Formatting is limited, not too rich, for example bold/italic styling, hyperlinks, unordered and ordered lists as well as list of documents (files) with hyperlinks.

For example such page can be used as a first item of learning sequence to give general information to the content of the sequence, provide links to presentation slides, lecture notes (PDF files) and links to addition materials in internet.


#### Video

A short video (5-30 minutes). It should be a link to a video stored somewhere else, for example on YouTube, Vimeo, or any specific CDN. The course admin provides the link when item is created, the system checks that it is valid and then uses this link to show video player for student.


#### Quiz

Quiz is one or several questions with possibilities to give an answer in several forms. Questions can be one of the types shown below.

Each type of question has a text (with actually a question/assignment) as a simple formatted text, however it should support mathematical formulas (e.g. latex inside markdown) and images. There are four types of questions:

* single choice (show several choices as radio buttons, only one is correct).
* multiple choices (show several choices as checkboxes, several can be correct).
* exact numeric answer (user should calculate a number and provide it with given precision, e.g. decimals). For example: 1.23
* exact text answer (user should provide text answer which should match exactly the expected value, space characters trimmed). For example: C2H5OH.

Questions can be added, removed or rearrenged inside each quiz only in "created" mode. When course version is published administrators can only change text of questions or answers without removing, adding new questions or new answers.


#### Interactive app

Interactive app is a Javascript module which is shown on the screen so students can communicate with it. See example here: [https://graasta.com/#asta-b102/](https://graasta.com/#asta-b102/). The idea is that either admin will give a link to a JS file available somewhere else. Or it will upload the JS file which will be activated when user enters the item.

We need to think about requirements for such js and how to check that it is harmless to avoid any issues here. Of course administrator is the one who takes all responsibility.

I have example of such js file in `asta-b101.js` located in the same folder as this file.


### Assets

Assets are files related to one course version (images, documents, JS files, etc) uploaded by the course creators/administrators. They should be stored in a specific directory and be available via direct links, for example:

```
/assets/abc102020zyx/01-Introduction.pdf
```

Where `abc102020zyx` is unique ID of a course version this document belongs to (e.g. its primary key in database).

When new version of course is created, automatically all assets are copied to a new directory. Course admins should have a tool to manipulate the assets (remove, add new, etc).

We need to think how to operate the assets correctly, how to see them, remove them, etc. Perhaps every item should be registed in special table in a database, so when user adds it to content it checks if the corresponding file exists. And if the item is deleted or replaced, everything is done correctly without loosing the integrity.


### Mini-projects

Mini-project is a special element. It is available only for course runs - see the idea of course run later - and only if administrator (who creates the course run) selects this option explicitly. In other words, normal course students will not see the mini-projects. It is only for specific cases.

Below is description of how mini-projects should work if they are selected/activated.

Every block of the course is linked to one mini-project. Mini-project is a special assignment, students should work on at the end of each block. Mini project has the document with assignment description (e.g. PDF file) and additional files, for example, datasets, code, etc. Students should be able to download these files.

When students are ready with the assignment they must upload mini-project report to the system as a  PDF file. Course teachers will evaluate the report using one of the following criteria:

* rejected (too bad or wrong document, resubmit)
* major revision (the report must be improved significantly)
* minor revision (the report must be improved slightly)
* accepted

Plus teachers should be able to upload the PDF file with report and their own comments/feedback, so students can see it.

If student gets any of the first three evaluation, they should have a possibility to submit a second revised version of the report. The second version is automatically accepted.

Important, students work on the mini-projects in groups. One group can be of 1 to 10 students. Any student from the group should be able to submit a report on behalf of the whole group. Groups belong to a course run (will be explained later).

Important, every mini-project should have 3 deadlines:
- soft deadline for initial submission
- hard deadline for initial submission
- deadline for resubmission

Three days before the soft deadline students gets a reminder - but only if they have not submitted their mini-project yet. After soft deadline is over (if still not submitetd) they get another reminder that the hard deadline is approaching. After hard deadline no submission is possible.

If students get option for improving the report and submit a new version it should be done within the deadline for resubmission.

Important, not all students have access to mini-projects. Only thouse who have a specific status and belong to a group. See more details in Users chapter and in Course run description.

Teachers should have access to mini-project assignment and be able to download the reports and evaluate them. Evaluation result should show name of teacher and date time when evluation was given. As mentioned in addition to evaluation score teachers can upload a PDF with feedback. This is mandatory if evaluation is not "accepted".


## Users

All registered users should have full name and email address stored in database. Email address should not be stored as is, but hashed to avoid any issues with security. The authentication is password less, users get pin code to email and possibility to remember session for 1, 7 or 30 days. If students log out manually the session is cancelled so they have to enter PIN again.

A user may have one or several roles. The roles (except *superuser* role) are assigned in relation for a course, not just alone.

*superuser* a user who can do everything, including adding courses and assigne other users as administrators of a course.

*admin*: a superuser for a specific course, can create new versions, modify them, assign teachers and invite students.

*teacher*: also for a specific course, can invite students, answer questions, evaluate assingments, check student progress.

*student*: also for specific course, can take the course including access to mini-projects if they are part of course run (explained below).


### Runs

By default any student who gets access to a course version take it in free form (free pace). There are no deadlines, etc. If the version is archived, students with access to this version can still use it.

However, sometimes it is needed to make more schedule based teaching. For example, if a course is also intended for a specific semester or a summer school. In this case course admin creates a course run.

Course run is linked to a specific course version. It has dates - date to start the run and date to finish the run. Inside the run students can be added to groups and work in groups on mini-projects. This is optional, when administrator creates a run it selects if mini-projects and groups must be activated.

When a student is added to run, and groups exists, then it should be associated with a group.

You can think about run as additional set up. Students in the run are like conventional students but with extra possibilities, like being part of a group, having access to mini-projects and possibilities to communicate with teachers.

After run is finished students have the same rights as conventional students who are not part of a run. But they always have acces to special view "Run" where they see all progress within this run, e.g. mini-projects, feedback from teachers, etc.

The same course version can have different runs. Each run may have different teachers associate with the run. For example it can be courses in different departments, etc.


## Architecture and developer stack

### Backend

Backed is written in Python using FastAPI framework + SQLAlchemy. Assets are saved into local file system, to separate directories. Directory name is ID of course version. The assets are static files, the directory with assets should be then open for HTTPS access if user has direct link. My understanding as this directory should be located somewhere outside backend and backedn should just know a path to this directory as a setiing.

I think that backend should return the whole course as JSON file. With 4 blocks x 3 sequences in each x 20 items = 240 items in average. Video items contain only link and title, the others will have some text, but I do not think the whole JSON will exceed 500 kB. I think it will be somewhere between 100 and 200 kB for most of the courses. In this case the navigation will be as follows:

```
/course-slug-name#block-name:sequence-name:item-name
```

Or similar. So symbols `#` and `:` will tell frontend how to navigate inside the course.


Alternatively each block should be returned as separate JSON in this case navifation will be:

```
/course-slug-name/block-name#sequence-name:item-name
```

These are just ideas, perhaps different approach is needed.

The database is PostgreSQL either locally installed or managed.


Backend needs a very careful planning, for example view for course run, for mini-projects for users, mini-projects for teachers, course creator, etc. The full discussion and detailed plan of the frontend will be created later.


### Frontend

Frontend is written using Svelte 5.x and manually written CSS, HTML templates, etc. Library `svelte-controls-basic` can be used for form elements inside course creator or for other forms.

The main page contains course lists and general information. If use is authenticated it shows all courses available for user with corresponding roles. When use clicks on a course it shows the course view.

The course view shows general information about the course (name, description, photos and names of teachers) and list of blocks with sequences. When user clicks on a sequence he/she gets a sequence view, where they see sequence of items as a set of small icons on top with current item highlighted.

Frontend needs a very careful planning, for example view for course run, for mini-projects for users, mini-projects for teachers, course creator, etc. The full discussion and detailed plan of the frontend will be created later.

### Deployment

The deployment should be via Docker and docker compose. But ideally there should be a CLI utility, e.g. `mathion` which user uses for installing, configuration and updating of the system.

The system itself is located on GitHub in releases as gz file.

For example the install `mathion` via `apt`, `apt-get`, `brew`, etc. And then run:

`mathion install`

After that system asks several questions, like:
- title of the system
- name and email of superuser
- email settings for sending mails (including email address the messages will be sent from).
- DNS name (e.g. www.myserver.com)
- settings for data base server

perhaps something else, like directory where user has CSS files with colors, etc. if they want to tune the look and feel of the system. Or perhaps these files can be copied later. We need to think how to support tuning/themming.

After everything is entered and checked the CLI utility takes care of everything (download docker images or build them from the scratch, install everything, etc).

It should be possible to install a particular version of the system e.g.:

`mathion install 1.2.0`

If user runs `mathion update` the system downloads latest version of backend and frontend. If it is necessary to migrate database for the new version, it shows a warning messages and asks user to make a back up of database. Then it backs up the current server state and implements all update procedures. At the end it asks user to check the status and if something goes wrong it rolls back.

