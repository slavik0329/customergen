var fs = require("fs");
var request = require('request');
var GooglePlaces = require("googleplaces");
var Crawler = require("simplecrawler");
var verifier = require('email-verify');


module.exports = function(filename, keyword, locationString, callback) {
    googleExtract(filename, keyword, locationString, function(leads) {
        step2(leads);
    });

    function step2(leads) {
        siteParser(leads, function(fullLeads) {
            step3(fullLeads);
        });
    }

    function step3(fullLeads) {
        var out = "";
        fullLeads.forEach(function(lead) {
            if (lead.emails.length) {
                out += '"' + keyword + '", "' + locationString + '", "' + lead.name + '", "' + lead.emails.join(",") + '", "' + lead.website + '", "' + lead.formatted_phone_number + '", "' + lead.formatted_address + '", "' + lead.rating + '"\n';
            }
        })
        callback(out);
    }
}

function googleExtract(outFile, keyword, locationString, callback) {
    if (!outFile || !keyword || !locationString) {
        process.exit();
    }

    GOOGLE_PLACES_API_KEY = "AIzaSyD8s_UOtBNwIyDuk47XfoRDz8BaQvkuqn0"
    GOOGLE_PLACES_OUTPUT_FORMAT = "json"

    var googlePlaces = new GooglePlaces(GOOGLE_PLACES_API_KEY, GOOGLE_PLACES_OUTPUT_FORMAT);
    var counter = 0;
    var leads = [];
    var refs = [];
    var detailIndex = 0;
    var location;

    request.post({
        url: "https://maps.googleapis.com/maps/api/geocode/json?address=" + locationString + "&key=" + GOOGLE_PLACES_API_KEY
    }, function(error, response, body) {
        response = JSON.parse(body);
        location = [response.results[0].geometry.location.lat, response.results[0].geometry.location.lng]

        findPlaces();
    });

    function findPlaces(next_page_token) {
        if (counter > 100) {
            return;
        }

        var parameters = {
            location: location,
            keyword: keyword,
            radius: 50000
        };

        if (next_page_token) {
            parameters.pagetoken = next_page_token;
        }

        googlePlaces.radarSearch(parameters, function(error, response) {
            if (error) throw error;
            for (i in response.results) {
                refs.push(response.results[i].reference)
            }

            if (response.next_page_token) {
                setTimeout(function() {
                    findPlaces(response.next_page_token);
                }, 5000)
            } else {
                setTimeout(function() {
                    nextDetail();
                }, 1000)
            }

        });
    }


    function nextDetail() {
        if (refs.length < detailIndex + 1) {
            callback(leads);
            return;
        }
        getDetails(refs[detailIndex])
        detailIndex++;
    }


    function getDetails(reference) {
        googlePlaces.placeDetailsRequest({
            reference: reference
        }, function(error, response) {
            if (error) throw error;
            if (response.result.website) {
                var lead = {
                    name: response.result.name,
                    website: response.result.website,
                    formatted_phone_number: response.result.formatted_phone_number,
                    formatted_address: response.result.formatted_address,
                    rating: response.result.rating,
                };

                leads.push(lead);
                // var percent = Math.round((detailIndex / refs.length) * 100)

                counter++;
            }
            nextDetail();
        });
    }
}

function siteParser(leads, callback) {
    var lastTime;
    var fullLeads = [];
    var count = 0;
    var myInterval;
    var crawler;

    parseNext();

    function parseNext() {
        myInterval = setTimeout(function() {
            crawler.stop();

            finishedSite();
        }, 30000)

        if (leads.length < count + 1) {
            var json = JSON.stringify(fullLeads);
            clearTimeout(myInterval);
            callback(fullLeads);
            return;
        }
        var emails = [];

        function validateEmails( emails, callback ) {
            var validateCount = 0;
            var validEmails = [];

            function validateNext() {
                if ( validateCount+1 > emails.length ) {
                    callback(validEmails);
                    return;
                }

                verifier.verify( emails[validateCount], function( err, info ){
                  if( err ) {
                    // console.log("false")
                  }
                  else{
                    if (info.success) {
                        validEmails.push( emails[validateCount] );
                    } else {
                        // console.log("false")
                    }
                  }

                  validateCount++;
                  validateNext();
                });

            }

            validateNext();
            
        }

        function finishedSite() {
            
            if ( count+1 > leads.length ) {
                parseNext();
                return;
            }

            validateEmails(emails, function (validEmails) {
                if ( leads[count] == undefined ) {
                    count++;
                    clearTimeout(myInterval);

                    setTimeout(function() {
                        delete crawler;
                        parseNext();
                    }, 1000)

                    return;
                }

                var tmpLead = {
                    name: leads[count].name,
                    emails: validEmails,
                    website: leads[count].website,
                    formatted_phone_number: leads[count].formatted_phone_number,
                    formatted_address: leads[count].formatted_address,
                    rating: leads[count].rating
                };

                fullLeads.push(tmpLead);
                count++;

                // var percent = Math.round((count / leads.length) * 100);

                clearTimeout(myInterval);

                setTimeout(function() {
                    delete crawler;
                    parseNext();
                }, 1000)
            })

        }

        crawler = Crawler.crawl(leads[count].website)
            .on("fetchcomplete", function(queueItem, buf, response) {
                var html = buf.toString();

                var tmpEmails = (html.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi) || []);

                if (tmpEmails.length) {
                    emails = emails.concat(tmpEmails);
                }

                emails = emails.getUnique();
            })
            .on("complete", function() {
                finishedSite();
            })
            .on("fetchtimeout", function(queueItem) {
                // console.log(queueItem.url + " - timeout")
            })
            .on("fetchclienterror", function(queueItem) {
                // console.log(queueItem.url + " - clienterror")
            })
            .on("fetchdataerror", function(queueItem) {
                // console.log(queueItem.url + " - dataerror")
            })
            .on("fetch404", function(queueItem) {
                // console.log(queueItem.url + " - 404")
            })
            .on("fetcherror", function(queueItem) {
                // console.log(queueItem.url + " - fetcherror")
            });


        crawler.maxDepth = 2;
        crawler.maxConcurrency = 10;
        crawler.downloadUnsupported = false;
        // crawler.listenerTTL = 2000;
        // crawler.timeout = 2000;
        // crawler.scanSubdomains  = true;
        // crawler.ignoreWWWDomain  = false;
        // crawler.userAgent = "Mozilla/5.0";
        // crawler.interval = 1000; // Ten seconds

        var conditionID = crawler.addFetchCondition(function(parsedURL) {
            return !parsedURL.path.match(/\.(js|jpg|gif|jpeg|bmp|css|png|xml|pdf)/i);
        });
    }

    Array.prototype.getUnique = function() {
        var u = {},
            a = [];
        for (var i = 0, l = this.length; i < l; ++i) {
            if (u.hasOwnProperty(this[i])) {
                continue;
            }
            a.push(this[i]);
            u[this[i]] = 1;
        }
        return a;
    }
}