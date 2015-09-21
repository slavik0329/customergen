var fs = require("fs");
var request = require('request');
var GooglePlaces = require("googleplaces");
var Crawler = require("simplecrawler");



// if ( !process.argv[2] || !process.argv[3] || !process.argv[4] ) {
// 	process.exit();
// }



module.exports = function (filename, keyword, locationString, callback) {
	googleExtract( filename, keyword, locationString, function (leads) {
		step2(leads);
	});

	function step2 (leads) {
		siteParser( leads, function (fullLeads) {
			step3(fullLeads);
		});
	}

	function step3 ( fullLeads ) {
		var out ="";
		fullLeads.forEach( function (lead) {
			if ( lead.emails.length ) {
				// console.log('"'+process.argv[3]+'", "'+process.argv[4]+'", "' + lead.name + '", "' + lead.emails.join(",") + '", "' + lead.website + '", "' + lead.formatted_phone_number + '", "' + lead.formatted_address + '", "' + lead.rating + '"')
				out+= '"'+keyword+'", "'+locationString+'", "' + lead.name + '", "' + lead.emails.join(",") + '", "' + lead.website + '", "' + lead.formatted_phone_number + '", "' + lead.formatted_address + '", "' + lead.rating + '"\n';
			}
		})
		fs.writeFile( "out/"+filename + ".csv", out );
	}
}



function googleExtract (outFile, keyword, locationString, callback) {
	if ( !outFile || !keyword || !locationString ) {
		process.exit();
	}

	var location;


	// GOOGLE_PLACES_API_KEY = "AIzaSyDnXC-C5WQqDfyTD2APcXVRPBY0Msq6oa8"
	GOOGLE_PLACES_API_KEY = "AIzaSyD8s_UOtBNwIyDuk47XfoRDz8BaQvkuqn0"
	GOOGLE_PLACES_OUTPUT_FORMAT = "json"

	var googlePlaces = new GooglePlaces(GOOGLE_PLACES_API_KEY, GOOGLE_PLACES_OUTPUT_FORMAT);
	var counter = 0;

	var leads = [];
	var refs = [];
	var detailIndex = 0;


	 request.post({
	   url:     "https://maps.googleapis.com/maps/api/geocode/json?address="+locationString+"&key=" + GOOGLE_PLACES_API_KEY
	 }, function(error, response, body){
	 	response = JSON.parse(body);
	 	location=[response.results[0].geometry.location.lat, response.results[0].geometry.location.lng]
	 	console.log(location);

	 	findPlaces();

	 	

	 });


	 
	 function findPlaces (next_page_token) {
	 	// console.log(counter);
	 	if (counter>100) {
	 		return;
	 	}
	 	var parameters = {
	 		location: location,
	 		keyword: keyword,
	 		radius: 50000
	 	};

	 	if ( next_page_token ) {
	 		parameters.pagetoken = next_page_token;
	 		// console.log("token: " +next_page_token)
	 	}


	 	googlePlaces.placeSearch(parameters, function (error, response) {
	 		if (error) throw error;
			// console.log(response);
			for ( i in response.results ) {
				// getDetails( response.results[i].reference )
				refs.push(response.results[i].reference )

				console.log("Loaded: " + response.results[i].name)


			}

			if ( response.next_page_token ) {
				setTimeout( function () {
					// console.log("looking next page - " + response.next_page_token)
					findPlaces(response.next_page_token);
				}, 5000)
			} else {
				// console.log(response)
				setTimeout( function () {
					// console.log(refs.length)
					// console.log("donepaging - next detail")

					nextDetail();
				}, 1000)
			}

		});
	 }


	function nextDetail () {
		if ( refs.length < detailIndex+1 ) {
			// fs.writeFile(outFile, JSON.stringify(leads) );
			callback(leads);
			return;
		}
		getDetails( refs[detailIndex] )
		detailIndex++;
	}


	 function getDetails( reference ) {
	 	googlePlaces.placeDetailsRequest({reference: reference}, function (error, response) {
	 		if (error) throw error;
	 		if ( response.result.website ) {
	 			var lead = {
	 				name: response.result.name,
	 				website: response.result.website,
	 				formatted_phone_number: response.result.formatted_phone_number,
	 				formatted_address: response.result.formatted_address,
	 				rating: response.result.rating,
	 			};

	 			leads.push( lead );
	 			var percent = Math.round((detailIndex/refs.length)*100)
	 			console.log("Loaded Details ("+percent+"%): " + lead.name)
	 			// console.log(lead);
	 			counter++;
	 		}
	 		nextDetail();
	 	});
	 }
}

function siteParser(leads, callback) {
	var lastTime;
	var fullLeads = [];

	var count =0;

	parseNext();

	var myInterval;
	var crawler;

	function parseNext () {
		myInterval = setTimeout(function () {
			crawler.stop();

			finishedSite();
		}, 30000)

		if ( leads.length < count + 1 ) {
			console.log("Finished");
			var json = JSON.stringify(fullLeads);
			clearTimeout(myInterval);
			// fs.writeFileSync( filename + "_emails", json );
			callback(fullLeads);
			return;
		}
		var emails = [];

		function finishedSite () {
			var tmpLead = {
				name: leads[count].name,
				emails: emails,
				website: leads[count].website,
					formatted_phone_number: leads[count].formatted_phone_number,
					formatted_address: leads[count].formatted_address,
					rating: leads[count].rating
			};

			fullLeads.push(tmpLead);
			count++;

			var percent = Math.round((count/leads.length)*100);
	    	console.log( "Loaded ("+percent+"%) " + tmpLead.name + " - " + tmpLead.website );

	    	clearTimeout( myInterval );

	    	setTimeout( function () {
	    		delete crawler;
	    		parseNext();

	    	}, 1000)
		}

		console.log( "Loading: " + leads[count].name + " - " + leads[count].website );

		crawler = Crawler.crawl(leads[count].website)
		    .on("fetchcomplete", function(queueItem, buf, response) {
	        	var html = buf.toString();
	        		    	console.log(queueItem.url)


	        	var tmpEmails = (html.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi) || []);
	        	if ( tmpEmails.length ) {
	        		emails = emails.concat(tmpEmails);
	        	}
	        	emails = emails.getUnique();
	        	// console.log(emails)

		  
		    })
		    .on("complete", function () {

	    		finishedSite();
		    })
		    .on("fetchtimeout", function (queueItem) {
		    	console.log(queueItem.url + " - timeout")
		    })
		    .on("fetchclienterror", function (queueItem) {
		    	console.log(queueItem.url + " - clienterror")
		    })
		    .on("fetchdataerror", function (queueItem) {
		    	console.log(queueItem.url + " - dataerror")
		    })
		    .on("fetch404", function (queueItem) {
		    	console.log(queueItem.url + " - 404")
		    })
		    .on("fetcherror", function (queueItem) {
		    	console.log(queueItem.url + " - fetcherror")
		    });


		crawler.maxDepth = 2;
		// crawler.interval = 1000; // Ten seconds
		crawler.maxConcurrency = 10;
		crawler.downloadUnsupported = false;
		// crawler.listenerTTL = 2000;
		// crawler.timeout = 2000;
		// crawler.scanSubdomains  = true;
		// crawler.ignoreWWWDomain  = false;
		// crawler.userAgent = "Mozilla/5.0";

		var conditionID = crawler.addFetchCondition(function(parsedURL) {
		    return !parsedURL.path.match(/\.(js|jpg|gif|jpeg|bmp|css|png|xml|pdf)/i);
		});
	}

	Array.prototype.getUnique = function(){
	   var u = {}, a = [];
	   for(var i = 0, l = this.length; i < l; ++i){
	      if(u.hasOwnProperty(this[i])) {
	         continue;
	      }
	      a.push(this[i]);
	      u[this[i]] = 1;
	   }
	   return a;
	}


}